from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from tournament.models import KnockoutMatch, Match, Season, Team, Tournament
from tournament.services import (
    compute_standings,
    create_knockout_matches,
    legs_for,
    record_knockout_score,
    setup_knockout,
)


LEAGUE_NAME = "Demo eFootball League"

PLAYERS = [
    ("Akshay", "Italy"),
    ("Babu", "Norway"),
    ("Shabeel", "Spain"),
    ("Shaji", "India"),
    ("Maadan", "Brazil"),
    ("Vyshnav", "Netherlands"),
    ("Ceejay", "Japan"),
    ("Ponnu", "Argentina"),
    ("Kaduva", "Cape Verde"),  # registered but inactive, so not in the season
]

# Full double round-robin: 14 rounds x 4 matches = 56 matches.
# Rounds 1-7 are the first leg, rounds 8-14 are the return leg (home/away swapped).
# Each tuple: (home, away, home_goals, away_goals)
FIXTURES = {
    1: [
        ("Netherlands", "Japan", 7, 0),
        ("Brazil", "Italy", 0, 1),
        ("Norway", "Argentina", 1, 0),
        ("India", "Spain", 6, 7),
    ],
    2: [
        ("Brazil", "Netherlands", 0, 1),
        ("Japan", "Argentina", 0, 1),
        ("India", "Italy", 0, 1),
        ("Norway", "Spain", 0, 0),
    ],
    3: [
        ("Netherlands", "Argentina", 1, 0),
        ("India", "Brazil", 2, 0),
        ("Japan", "Spain", 7, 7),
        ("Norway", "Italy", 0, 1),
    ],
    4: [
        ("India", "Netherlands", 0, 1),
        ("Argentina", "Spain", 0, 0),
        ("Norway", "Brazil", 7, 0),
        ("Japan", "Italy", 0, 1),
    ],
    5: [
        ("Netherlands", "Spain", 1, 0),
        ("Norway", "India", 7, 0),
        ("Argentina", "Italy", 7, 7),
        ("Japan", "Brazil", 7, 7),
    ],
    6: [
        ("Norway", "Netherlands", 7, 7),
        ("Spain", "Italy", 5, 5),
        ("Japan", "India", 0, 1),
        ("Argentina", "Brazil", 0, 0),
    ],
    7: [
        ("Netherlands", "Italy", 0, 0),
        ("Japan", "Norway", 0, 0),
        ("Spain", "Brazil", 4, 4),
        ("Argentina", "India", 1, 0),
    ],
    8: [
        ("Japan", "Netherlands", 5, 4),
        ("Italy", "Brazil", 0, 1),
        ("Argentina", "Norway", 5, 7),
        ("Spain", "India", 1, 0),
    ],
    9: [
        ("Netherlands", "Brazil", 1, 0),
        ("Argentina", "Japan", 1, 0),
        ("Italy", "India", 1, 0),
        ("Spain", "Norway", 0, 1),
    ],
    10: [
        ("Argentina", "Netherlands", 0, 7),
        ("Brazil", "India", 0, 4),
        ("Spain", "Japan", 1, 0),
        ("Italy", "Norway", 6, 4),
    ],
    11: [
        ("Netherlands", "India", 5, 2),
        ("Spain", "Argentina", 0, 0),
        ("Brazil", "Norway", 0, 1),
        ("Italy", "Japan", 1, 0),
    ],
    12: [
        ("Spain", "Netherlands", 0, 7),
        ("India", "Norway", 7, 0),
        ("Italy", "Argentina", 1, 1),
        ("Brazil", "Japan", 1, 0),
    ],
    13: [
        ("Netherlands", "Norway", 3, 3),
        ("Italy", "Spain", 0, 2),
        ("India", "Japan", 1, 0),
        ("Brazil", "Argentina", 3, 0),
    ],
    14: [
        ("Italy", "Netherlands", 2, 7),
        ("Norway", "Japan", 0, 0),
        ("Brazil", "Spain", 0, 3),
        ("India", "Argentina", 0, 0),
    ],
}

# Expected final table: club -> (P, W, D, L, GF, GA, Pts)
EXPECTED = {
    "Netherlands": (14, 10, 3, 1, 52, 19, 33),
    "Italy":       (14, 7, 4, 3, 27, 27, 25),
    "Norway":      (14, 6, 5, 3, 38, 29, 23),
    "Spain":       (14, 5, 6, 3, 30, 31, 21),
    "India":       (14, 5, 1, 8, 23, 24, 16),
    "Argentina":   (14, 3, 6, 5, 16, 27, 15),
    "Brazil":      (14, 3, 3, 8, 16, 31, 12),
    "Japan":       (14, 1, 4, 9, 19, 33, 7),
}


# --------------------------------------------------
# KNOCKOUT (top 6 qualify: seeds 1-2 get a first-round bye)
# --------------------------------------------------
# League finish -> seeds: 1 Vyshnav, 2 Akshay, 3 Babu, 4 Shabeel, 5 Shaji, 6 Ponnu

KNOCKOUT_TEAMS = 6
ROUND_LEGS = {"quarter_final": 1, "semi_final": 2, "final": 1}

# Quarter-final pairings (tie_number -> (home, away)). Vyshnav and Akshay have byes.
# These are set explicitly, so they differ from the generator's own
# seeding (which would pair Shabeel-Shaji and Babu-Ponnu).
QUARTER_FINALS = {
    2: ("Shabeel", "Ponnu"),
    4: ("Shaji", "Babu"),
}

# Played in this order so winners advance correctly.
# (home, away, home_goals, away_goals, home_pens, away_pens)
KNOCKOUT_RESULTS = [
    # Quarter-finals (1 leg)
    ("Shabeel", "Ponnu", 2, 1, None, None),      # Shabeel win
    ("Shaji", "Babu", 1, 1, 3, 4),               # Babu win on penalties
    # Semi-final 1: Vyshnav v Shabeel (2 legs), Vyshnav 4-2 on aggregate
    ("Vyshnav", "Shabeel", 3, 1, None, None),
    ("Shabeel", "Vyshnav", 1, 1, None, None),
    # Semi-final 2: Akshay v Babu (2 legs), Akshay 3-1 on aggregate
    ("Akshay", "Babu", 2, 0, None, None),
    ("Babu", "Akshay", 1, 1, None, None),
    # Final (1 leg)
    ("Vyshnav", "Akshay", 1, 2, None, None),     # Akshay win
]
CHAMPION = "Akshay"


def _set_quarter_final_pairings(stage, players):
    """Replace the generated round-1 pairings with the demo's chosen ones."""
    for tie_number, (home, away) in QUARTER_FINALS.items():
        tie = stage.ties.get(round_number=1, tie_number=tie_number)
        tie.matches.all().delete()
        tie.home, tie.away = players[home], players[away]
        tie.save(update_fields=["home", "away"])
        create_knockout_matches(tie, legs_for(stage, tie.round_type))


def _play(stage, home, away, home_goals, away_goals, home_pens, away_pens):
    leg = KnockoutMatch.objects.get(
        tie__stage=stage,
        home__player_name=home,
        away__player_name=away,
        status="scheduled",
    )
    record_knockout_score(leg.pk, home_goals, away_goals, home_pens, away_pens)


class Command(BaseCommand):

    help = (
        "Create a completed demo eFootball league: one season, a full fixture list "
        "and a finished knockout stage."
    )

    @transaction.atomic
    def handle(self, *args, **options):

        # Delete previous demo tournament only (cascades to knockout data)
        Tournament.objects.filter(name=LEAGUE_NAME).delete()

        # 1. Tournament
        tournament = Tournament.objects.create(name=LEAGUE_NAME, status="finished")

        # 2. Register all nine teams (Cape Verde is inactive)
        Team.objects.bulk_create([
            Team(
                tournament=tournament,
                player_name=player_name,
                club_name=country,
                is_active=(country != "Cape Verde"),
            )
            for player_name, country in PLAYERS
        ])
        teams = {t.club_name: t for t in tournament.teams.all()}
        active_teams = {c: t for c, t in teams.items() if t.is_active}
        players = {t.player_name: t for t in active_teams.values()}

        # 3. Season 1 with the active roster
        season = Season.objects.create(tournament=tournament, number=1, status="finished")
        season.teams.set(active_teams.values())

        # 4. Every league fixture with its result.
        # bulk_create skips save(), so status is set explicitly.
        matches = [
            Match(
                season=season,
                round=round_number,
                home=active_teams[home],
                away=active_teams[away],
                home_goals=home_goals,
                away_goals=away_goals,
                status="played",
            )
            for round_number, round_matches in FIXTURES.items()
            for home, away, home_goals, away_goals in round_matches
        ]
        Match.objects.bulk_create(matches)

        # 5. Verify the computed table matches the target exactly
        # (raising here rolls the whole transaction back)
        for row in compute_standings(season, include_logo=False):
            got = (row["played"], row["won"], row["drawn"], row["lost"],
                   row["gf"], row["ga"], row["points"])
            want = EXPECTED[row["club_name"]]
            if got != want:
                raise CommandError(f"{row['club_name']}: expected {want}, got {got}")

        # 6. Knockout: qualify top 6, build the bracket (byes for seeds 1-2),
        # then play it through the real scoring logic so winners advance.
        try:
            stage = setup_knockout(season, KNOCKOUT_TEAMS, ROUND_LEGS)
            _set_quarter_final_pairings(stage, players)
            for result in KNOCKOUT_RESULTS:
                _play(stage, *result)
        except ValueError as error:
            raise CommandError(f"Knockout setup failed: {error}")

        stage.refresh_from_db()
        champion = stage.champion.player_name if stage.champion else None
        if stage.status != "finished" or champion != CHAMPION:
            raise CommandError(
                f"Expected {CHAMPION} to win the knockout, got {champion} ({stage.status})."
            )

        # 7. Summary
        self.stdout.write(
            self.style.SUCCESS(
                f"\nLeague created successfully!"
                f"\nTournament: {tournament.name}"
                f"\nSeason: {season.number}"
                f"\nRegistered teams: {len(teams)}"
                f"\nActive teams: {len(active_teams)}"
                f"\nInactive teams: {len(teams) - len(active_teams)}"
                f"\nRounds: {len(FIXTURES)}"
                f"\nMatches: {len(matches)}"
                f"\nStandings verified against target table"
                f"\nKnockout: top {KNOCKOUT_TEAMS} qualified, finished"
                f"\nChampion: {champion}"
                f"\nTournament status: Finished\n"
            )
        )