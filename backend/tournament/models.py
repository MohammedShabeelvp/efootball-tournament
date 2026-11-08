from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower


# --------------------------------------------------
# SHARED BASE
# --------------------------------------------------

class ResultMixin(models.Model):
    """
    Score + status shared by league and knockout matches.
    Status is derived: a match is 'played' once both scores exist.
    Abstract, so there is no schema change from moving these fields here.
    """

    STATUS = [("scheduled", "Scheduled"), ("played", "Played")]

    home_goals = models.PositiveIntegerField(null=True, blank=True)
    away_goals = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default="scheduled")
    scheduled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        both = self.home_goals is not None and self.away_goals is not None
        self.status = "played" if both else "scheduled"

        # save(update_fields=[...]) would otherwise skip the recomputed status
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and "status" not in update_fields:
            kwargs["update_fields"] = [*update_fields, "status"]

        super().save(*args, **kwargs)


# --------------------------------------------------
# LEAGUE
# --------------------------------------------------

class Tournament(models.Model):
    STATUS = [("draft", "Draft"), ("ongoing", "Ongoing"), ("finished", "Finished")]

    name = models.CharField(max_length=120)
    status = models.CharField(max_length=20, choices=STATUS, default="draft")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class Team(models.Model):
    """One team = one player using one club in eFootball."""

    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="teams")
    player_name = models.CharField(max_length=80)
    efootball_id = models.CharField(max_length=50, blank=True)
    club_name = models.CharField(max_length=80)
    logo = models.ImageField(upload_to="logos/", blank=True)
    lineup_image = models.ImageField(upload_to="lineups/", blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["player_name"]
        constraints = [
            # Case-insensitive: the API already rejects "Ali" vs "ali" with an
            # iexact check, but only the database can stop two concurrent requests.
            models.UniqueConstraint(
                Lower("player_name"), "tournament", name="uniq_team_player_per_tournament"
            ),
        ]

    def __str__(self):
        return f"{self.player_name} ({self.club_name})"


class Season(models.Model):
    STATUS = [("upcoming", "Upcoming"), ("ongoing", "Ongoing"), ("finished", "Finished")]

    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="seasons")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=20, choices=STATUS, default="upcoming")
    teams = models.ManyToManyField(Team, related_name="seasons", blank=True)  # who plays this season
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-number"]
        constraints = [
            models.UniqueConstraint(fields=["tournament", "number"], name="uniq_season_number"),
            # only one running season per tournament
            models.UniqueConstraint(
                fields=["tournament"], condition=Q(status="ongoing"), name="one_ongoing_season"
            ),
        ]
        indexes = [
            # season_running() and create_season() filter on tournament + status
            models.Index(fields=["tournament", "status"], name="season_tournament_status_idx"),
        ]

    def __str__(self):
        # Use select_related("tournament") wherever seasons are listed
        return f"{self.tournament.name} - Season {self.number}"


class Match(ResultMixin):
    season = models.ForeignKey(Season, on_delete=models.CASCADE, related_name="matches")
    round = models.PositiveIntegerField()
    home = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="home_matches")
    away = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="away_matches")

    class Meta:
        ordering = ["round", "scheduled_at", "id"]
        constraints = [
            models.CheckConstraint(condition=~Q(home=F("away")), name="home_not_equal_away"),
        ]
        indexes = [
            # standings, "unplayed" checks and the knockout gate all filter season + status
            models.Index(fields=["season", "status"], name="match_season_status_idx"),
            # fixtures list / ?round= filter
            models.Index(fields=["season", "round"], name="match_season_round_idx"),
        ]

    def __str__(self):
        return f"R{self.round}: {self.home} vs {self.away}"


# --------------------------------------------------
# KNOCKOUT
# --------------------------------------------------

class KnockoutStage(models.Model):
    """Knockout configuration for one finished league season."""

    STATUS = [("planned", "Planned"), ("setup", "Setup"), ("ongoing", "Ongoing"), ("finished", "Finished")]

    season = models.OneToOneField(Season, on_delete=models.CASCADE, related_name="knockout_stage")
    qualifying_teams = models.PositiveSmallIntegerField()
    # Legs per round, chosen by the organizer, e.g.
    # {"quarter_final": 1, "semi_final": 2, "final": 1, "third_place": 1}
    round_legs = models.JSONField(default=dict)
    third_place_match = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=STATUS, default="setup")
    champion = models.ForeignKey(
        Team, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.season} knockout"


class KnockoutEntry(models.Model):
    """A team that qualified from the league table, seeded by league position."""

    stage = models.ForeignKey(KnockoutStage, on_delete=models.CASCADE, related_name="entries")
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="knockout_entries")
    seed = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["seed"]
        constraints = [
            models.UniqueConstraint(fields=["stage", "team"], name="uniq_entry_team"),
            models.UniqueConstraint(fields=["stage", "seed"], name="uniq_entry_seed"),
        ]


class KnockoutTie(models.Model):
    """One pairing (one or two legs). Winners flow on through next_tie / winner_slot."""

    SLOTS = [("home", "Home"), ("away", "Away")]

    stage = models.ForeignKey(KnockoutStage, on_delete=models.CASCADE, related_name="ties")
    round_number = models.PositiveSmallIntegerField()  # 1 = first round
    round_type = models.CharField(max_length=30)       # quarter_final, semi_final, final, third_place...
    tie_number = models.PositiveSmallIntegerField()
    home = models.ForeignKey(Team, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    away = models.ForeignKey(Team, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    winner = models.ForeignKey(Team, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    next_tie = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="feeder_ties"
    )
    winner_slot = models.CharField(max_length=4, choices=SLOTS, blank=True)

    # semi-final losers drop into the third-place tie
    loser_next_tie = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="loser_feeder_ties"
    )
    loser_slot = models.CharField(max_length=4, choices=SLOTS, blank=True)

    class Meta:
        ordering = ["round_number", "tie_number", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["stage", "round_type", "tie_number"], name="uniq_tie_per_round"
            ),
            models.CheckConstraint(condition=~Q(home=F("away")), name="ko_home_not_equal_away"),
        ]

    def __str__(self):
        return f"{self.round_type} #{self.tie_number}"


class KnockoutMatch(ResultMixin):
    """One leg of a tie. Created only once both teams of the tie are known."""

    tie = models.ForeignKey(KnockoutTie, on_delete=models.CASCADE, related_name="matches")
    leg_number = models.PositiveSmallIntegerField()
    home = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="+")
    away = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="+")
    # Shoot-out, only used on the last leg when the tie is level on aggregate
    home_pens = models.PositiveIntegerField(null=True, blank=True)
    away_pens = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["tie_id", "leg_number"]
        constraints = [
            models.UniqueConstraint(fields=["tie", "leg_number"], name="uniq_leg_per_tie"),
            models.CheckConstraint(condition=~Q(home=F("away")), name="ko_leg_home_not_equal_away"),
        ]
        indexes = [
            # reset_knockout() asks "any played leg in this stage's ties?"
            models.Index(fields=["tie", "status"], name="komatch_tie_status_idx"),
        ]