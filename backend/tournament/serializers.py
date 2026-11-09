from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from rest_framework import serializers

from .models import (
    KnockoutEntry,
    KnockoutMatch,
    KnockoutStage,
    KnockoutTie,
    Match,
    Season,
    Team,
    Tournament,
)
from .services import (
    MAX_KNOCKOUT_TEAMS,
    compute_standings,
    season_running,
    team_form,
    tie_needs_penalties,
    tie_totals,
)

MAX_IMAGE_MB = 5


def _annotated(obj, name, fallback):
    """Use a value annotated by the view's queryset, else compute it (1 query)."""
    value = getattr(obj, name, None)
    return fallback() if value is None else value


# --------------------------------------------------
# IMAGE FIELDS
# --------------------------------------------------

class RelativeImageField(serializers.ImageField):
    """Return a relative media URL."""

    def to_representation(self, value):
        return value.url if value else None


def validate_image_size(file):
    if file.size > MAX_IMAGE_MB * 1024 * 1024:
        raise serializers.ValidationError(f"Image must be smaller than {MAX_IMAGE_MB} MB.")


def image_field(**kwargs):
    return RelativeImageField(
        required=False,
        allow_null=True,
        validators=[validate_image_size],
        **kwargs,
    )


# --------------------------------------------------
# TEAMS
# --------------------------------------------------

class TeamBriefSerializer(serializers.ModelSerializer):
    logo = RelativeImageField(read_only=True)

    class Meta:
        model = Team
        fields = ["id", "player_name", "club_name", "logo"]


class TeamSerializer(serializers.ModelSerializer):
    """List, create and update tournament teams."""

    logo = image_field()
    lineup_image = image_field()

    class Meta:
        model = Team
        fields = [
            "id",
            "player_name",
            "efootball_id",
            "club_name",
            "logo",
            "lineup_image",
            "is_active",
        ]

    def validate_is_active(self, value):
        team = self.instance
        # Cheap comparison first; the season query only runs on a real change
        if team and value != team.is_active and season_running(team.tournament):
            raise serializers.ValidationError(
                "Can't change active status while a season is running."
            )
        return value


# --------------------------------------------------
# LEAGUE MATCHES
# --------------------------------------------------

class MatchSerializer(serializers.ModelSerializer):
    home = TeamBriefSerializer(read_only=True)
    away = TeamBriefSerializer(read_only=True)

    class Meta:
        model = Match
        fields = [
            "id",
            "round",
            "home",
            "away",
            "home_goals",
            "away_goals",
            "status",
            "scheduled_at",
        ]


class MatchScoreSerializer(serializers.ModelSerializer):
    home_goals = serializers.IntegerField(
        min_value=0, max_value=99, allow_null=True, required=False
    )
    away_goals = serializers.IntegerField(
        min_value=0, max_value=99, allow_null=True, required=False
    )

    class Meta:
        model = Match
        fields = ["home_goals", "away_goals"]

    def validate(self, attrs):
        home = attrs.get("home_goals", self.instance.home_goals)
        away = attrs.get("away_goals", self.instance.away_goals)
        if (home is None) != (away is None):
            raise serializers.ValidationError("Enter both scores, or leave both empty.")
        return attrs


# --------------------------------------------------
# TOURNAMENT
# --------------------------------------------------

class TournamentSerializer(serializers.ModelSerializer):
    team_count = serializers.SerializerMethodField()
    match_count = serializers.SerializerMethodField()
    season_running = serializers.SerializerMethodField()

    class Meta:
        model = Tournament
        fields = [
            "id",
            "name",
            "status",
            "team_count",
            "match_count",
            "created_at",
            "season_running",
        ]
        read_only_fields = ["created_at"]

    @staticmethod
    def setup_eager_loading(queryset):
        """Call in the view: turns 3 queries per tournament into 0."""
        return queryset.annotate(
            ann_team_count=Count("teams", distinct=True),
            ann_match_count=Count("seasons__matches", distinct=True),
            ann_season_running=Exists(
                Season.objects.filter(tournament=OuterRef("pk"), status="ongoing")
            ),
        )

    def get_team_count(self, tournament):
        return _annotated(tournament, "ann_team_count", tournament.teams.count)

    def get_match_count(self, tournament):
        return _annotated(
            tournament,
            "ann_match_count",
            lambda: Match.objects.filter(season__tournament=tournament).count(),
        )

    def get_season_running(self, tournament):
        return _annotated(
            tournament, "ann_season_running", lambda: season_running(tournament)
        )


# --------------------------------------------------
# TEAM DETAIL
# --------------------------------------------------

class TeamDetailSerializer(serializers.ModelSerializer):
    logo = RelativeImageField(read_only=True)
    lineup_image = RelativeImageField(read_only=True)
    tournament = TournamentSerializer(read_only=True)

    stats = serializers.SerializerMethodField()
    form = serializers.SerializerMethodField()
    matches_total = serializers.SerializerMethodField()
    career_played = serializers.SerializerMethodField()
    fixtures = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = [
            "id",
            "player_name",
            "efootball_id",
            "club_name",
            "logo",
            "lineup_image",
            "is_active",
            "tournament",
            "stats",
            "form",
            "matches_total",
            "career_played",
            "fixtures",
        ]

    # Both helpers cache on the team instance: previously the season was
    # fetched 4x and the fixtures query ran twice per team.

    def _season(self, team):
        """Most recent season this team was registered in."""
        if not hasattr(team, "_latest_season"):
            team._latest_season = team.seasons.order_by("-number").first()
        return team._latest_season

    def _fixtures(self, team):
        if not hasattr(team, "_fixture_list"):
            season = self._season(team)
            team._fixture_list = [] if not season else list(
                Match.objects.filter(Q(home=team) | Q(away=team), season=season)
                .select_related("home", "away")
                .order_by("round", "scheduled_at", "id")
            )
        return team._fixture_list

    def get_stats(self, team):
        season = self._season(team)
        if not season:
            return None

        # Skip logo URL lookups for every other team in the table
        row = next(
            (r for r in compute_standings(season, include_logo=False)
             if r["team_id"] == team.id),
            None,
        )
        if row is not None:
            row["logo"] = team.logo.url if team.logo else None
        return row

    def get_form(self, team):
        season = self._season(team)
        return team_form(team, limit=5, season=season) if season else []

    def get_matches_total(self, team):
        return len(self._fixtures(team))

    def get_career_played(self, team):
        """Played matches across all tournaments for teams sharing this player name."""
        team_ids = Team.objects.filter(
            player_name__iexact=team.player_name
        ).values("id")  # stays a subquery: one DB hit

        return Match.objects.filter(status="played").filter(
            Q(home_id__in=team_ids) | Q(away_id__in=team_ids)
        ).count()

    def get_fixtures(self, team):
        return MatchSerializer(
            self._fixtures(team), many=True, context=self.context
        ).data


# --------------------------------------------------
# SEASON
# --------------------------------------------------

class SeasonSerializer(serializers.ModelSerializer):
    team_count = serializers.SerializerMethodField()
    match_count = serializers.SerializerMethodField()

    class Meta:
        model = Season
        fields = [
            "id",
            "tournament",
            "number",
            "status",
            "team_count",
            "match_count",
            "created_at",
        ]
        read_only_fields = ["number", "status", "created_at"]

    @staticmethod
    def setup_eager_loading(queryset):
        return queryset.annotate(
            ann_team_count=Count("teams", distinct=True),
            ann_match_count=Count("matches", distinct=True),
        )

    def get_team_count(self, season):
        return _annotated(season, "ann_team_count", season.teams.count)

    def get_match_count(self, season):
        return _annotated(season, "ann_match_count", season.matches.count)


# --------------------------------------------------
# KNOCKOUT: INPUT
# --------------------------------------------------

class KnockoutSetupSerializer(serializers.Serializer):
    """Values the organizer chooses when creating the knockout."""

    qualifying_teams = serializers.IntegerField(min_value=2, max_value=MAX_KNOCKOUT_TEAMS)
    third_place_match = serializers.BooleanField(default=False)
    seeding = serializers.ChoiceField(choices=["table", "random", "manual"], default="table")
    # e.g. {"quarter_final": 1, "semi_final": 2, "final": 1}
    round_legs = serializers.DictField(child=serializers.ChoiceField(choices=[1, 2]))


class KnockoutArrangeSerializer(serializers.Serializer):
    """Either place teams by hand (slots) or ask for a new random draw."""

    # two entries per first-round tie, in order; null = bye
    slots = serializers.ListField(child=serializers.IntegerField(allow_null=True), required=False)
    random = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if bool(attrs.get("slots")) == bool(attrs.get("random")):
            raise serializers.ValidationError("Send either slots or random: true.")
        return attrs


class KnockoutMatchScoreSerializer(serializers.Serializer):
    """Whole result for one leg. Send goals as null/null to clear it."""

    home_goals = serializers.IntegerField(min_value=0, max_value=99, allow_null=True)
    away_goals = serializers.IntegerField(min_value=0, max_value=99, allow_null=True)
    home_pens = serializers.IntegerField(min_value=0, max_value=99, allow_null=True, default=None)
    away_pens = serializers.IntegerField(min_value=0, max_value=99, allow_null=True, default=None)

    def validate(self, attrs):
        if (attrs["home_goals"] is None) != (attrs["away_goals"] is None):
            raise serializers.ValidationError("Enter both scores, or leave both empty.")
        if (attrs["home_pens"] is None) != (attrs["away_pens"] is None):
            raise serializers.ValidationError("Enter both penalty scores, or neither.")
        if attrs["home_goals"] is None and attrs["home_pens"] is not None:
            raise serializers.ValidationError("Penalties need a match score first.")
        return attrs


# --------------------------------------------------
# KNOCKOUT: OUTPUT
# --------------------------------------------------

class KnockoutMatchSerializer(serializers.ModelSerializer):
    home = TeamBriefSerializer(read_only=True)
    away = TeamBriefSerializer(read_only=True)

    class Meta:
        model = KnockoutMatch
        fields = [
            "id",
            "leg_number",
            "home",
            "away",
            "home_goals",
            "away_goals",
            "home_pens",
            "away_pens",
            "status",
            "scheduled_at",
        ]


class KnockoutTieSerializer(serializers.ModelSerializer):
    home = TeamBriefSerializer(read_only=True)
    away = TeamBriefSerializer(read_only=True)
    winner = TeamBriefSerializer(read_only=True)
    matches = KnockoutMatchSerializer(many=True, read_only=True)
    aggregate = serializers.SerializerMethodField()
    needs_penalties = serializers.SerializerMethodField()
    is_bye = serializers.SerializerMethodField()
    legs = serializers.SerializerMethodField()

    class Meta:
        model = KnockoutTie
        fields = [
            "id",
            "round_number",
            "round_type",
            "tie_number",
            "home",
            "away",
            "winner",
            "is_bye",
            "aggregate",
            "needs_penalties",
            "legs",
            "matches",
        ]

    @staticmethod
    def _matches(tie):
        """Legs, listed once per tie (previously re-listed in 3 methods)."""
        if not hasattr(tie, "_leg_list"):
            tie._leg_list = list(tie.matches.all())
        return tie._leg_list

    def get_aggregate(self, tie):
        if not tie.home_id or not tie.away_id:
            return None
        h, a = tie_totals(tie, self._matches(tie))
        return {"home": h, "away": a}

    def get_needs_penalties(self, tie):
        return tie_needs_penalties(tie, self._matches(tie))

    def get_legs(self, tie):
        # The stage passes round_legs via context so ties needn't join the stage
        round_legs = self.context.get("round_legs") or tie.stage.round_legs
        return round_legs.get(tie.round_type)

    def get_is_bye(self, tie):
        # a decided tie that never had any matches
        return bool(tie.winner_id) and not self._matches(tie)


class KnockoutEntrySerializer(serializers.ModelSerializer):
    team = TeamBriefSerializer(read_only=True)

    class Meta:
        model = KnockoutEntry
        fields = ["seed", "team"]


class KnockoutStageSerializer(serializers.ModelSerializer):
    champion = TeamBriefSerializer(read_only=True)
    entries = KnockoutEntrySerializer(many=True, read_only=True)
    rounds = serializers.SerializerMethodField()

    class Meta:
        model = KnockoutStage
        fields = [
            "id",
            "season",
            "qualifying_teams",
            "round_legs",
            "third_place_match",
            "seeding",
            "status",
            "champion",
            "entries",
            "rounds",
            "created_at",
        ]

    @staticmethod
    def setup_eager_loading(queryset):
        """Call in the view to avoid per-stage queries for champion and entries."""
        return queryset.select_related("champion").prefetch_related(
            Prefetch(
                "entries",
                queryset=KnockoutEntry.objects.select_related("team").order_by("seed"),
            )
        )

    def get_rounds(self, stage):
        """Ties grouped by round, in bracket order (third place sits beside the final)."""
        ties = list(
            stage.ties.select_related("home", "away", "winner")
            .prefetch_related(
                Prefetch(
                    "matches",
                    queryset=KnockoutMatch.objects.select_related("home", "away")
                    .order_by("leg_number"),
                )
            )
            # Explicit order: grouping below depends on consecutive round types
            .order_by("round_number", "id")
        )

        # One many=True pass instead of one serializer per tie
        context = {**self.context, "round_legs": stage.round_legs}
        data = KnockoutTieSerializer(ties, many=True, context=context).data

        rounds = []
        for tie, tie_data in zip(ties, data):
            if not rounds or rounds[-1]["round_type"] != tie.round_type:
                rounds.append(
                    {
                        "round_number": tie.round_number,
                        "round_type": tie.round_type,
                        "ties": [],
                    }
                )
            rounds[-1]["ties"].append(tie_data)
        return rounds