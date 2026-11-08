"""Pure business logic: fixture generation, season management, standings and knockouts."""

from django.db import transaction
from django.db.models import Count, Max, Q

from .models import (
    KnockoutEntry,
    KnockoutMatch,
    KnockoutStage,
    KnockoutTie,
    Match,
    Season,
)

MAX_KNOCKOUT_TEAMS = 64


# --------------------------------------------------
# FIXTURE GENERATION
# --------------------------------------------------

def round_robin_pairs(team_ids, double_round=False):
    """Circle method. Returns [[(home_id, away_id), ...], ...]. Odd counts get a BYE."""
    ids = list(team_ids)
    if len(ids) < 2:
        return []
    if len(ids) % 2:
        ids.append(None)

    n = len(ids)
    half = n // 2
    rounds = []

    for r in range(n - 1):
        pairs = []
        for i in range(half):
            a, b = ids[i], ids[n - 1 - i]
            if a is None or b is None:
                continue
            pairs.append((a, b) if (r + i) % 2 == 0 else (b, a))
        rounds.append(pairs)
        # Rotate all teams except the first
        ids = [ids[0], ids[-1]] + ids[1:-1]

    if double_round:
        rounds += [[(away, home) for home, away in rnd] for rnd in rounds]

    return rounds


# --------------------------------------------------
# SEASON MANAGEMENT
# --------------------------------------------------

def season_running(tournament):
    return tournament.seasons.filter(status="ongoing").exists()


@transaction.atomic
def create_season(tournament):
    """Create the next season and snapshot the active teams into its roster."""

    # One query instead of two existence checks
    statuses = set(
        tournament.seasons.filter(status__in=("ongoing", "upcoming"))
        .values_list("status", flat=True)
    )
    if "ongoing" in statuses:
        raise ValueError("The tournament already has an ongoing season.")
    if "upcoming" in statuses:
        raise ValueError("There is already an upcoming season.")

    # Validate BEFORE writing anything
    team_ids = list(
        tournament.teams.filter(is_active=True).values_list("id", flat=True)
    )
    if len(team_ids) < 2:
        raise ValueError("At least 2 active teams are required to create a season.")

    last = tournament.seasons.aggregate(m=Max("number"))["m"] or 0
    season = Season.objects.create(
        tournament=tournament, number=last + 1, status="upcoming"
    )
    season.teams.set(team_ids)
    return season


@transaction.atomic
def end_season(season, force=False):
    if season.status != "ongoing":
        raise ValueError("Only a running season can be ended.")

    if not force:
        unplayed = season.matches.filter(status="scheduled").count()
        if unplayed:
            raise ValueError(f"{unplayed} matches are still unplayed.")

    season.status = "finished"
    season.save(update_fields=["status"])

    # A planned knockout is built right away when the whole league was played.
    # (After a forced end with unplayed matches it waits for a staff member to build it.)
    if not season.matches.exclude(status="played").exists():
        return activate_planned_knockout(season)
    return None


class ResultsWouldBeLost(ValueError):
    """Scrapping would delete played matches and force was not given."""


@transaction.atomic
def scrap_season(season, force=False):
    """
    Delete a season and everything under it: fixtures, results and any knockout.
    Teams are not touched. A season with played matches needs force=True.
    """
    season = Season.objects.select_for_update().get(pk=season.pk)

    league_played = season.matches.filter(status="played").count()
    knockout_played = KnockoutMatch.objects.filter(
        tie__stage__season=season, status="played"
    ).count()

    if (league_played or knockout_played) and not force:
        parts = []
        if league_played:
            parts.append(f"{league_played} played league matches")
        if knockout_played:
            parts.append(f"{knockout_played} played knockout matches")
        raise ResultsWouldBeLost(
            f"Season {season.number} has {' and '.join(parts)}. "
            "Scrapping it deletes these results for good."
        )

    summary = {
        "season": season.number,
        "league_matches": season.matches.count(),
        "league_played": league_played,
        "knockout_ties": KnockoutTie.objects.filter(stage__season=season).count(),
        "knockout_played": knockout_played,
    }
    season.delete()  # cascades to matches, roster links and the knockout
    return summary


@transaction.atomic
def generate_fixtures(season, double_round=False):
    """Generate fixtures from the season's locked roster."""

    if season.status != "upcoming":
        raise ValueError("Fixtures can only be generated for an upcoming season.")
    if season.matches.exists():
        raise ValueError("Fixtures already exist for this season.")
    if season_running(season.tournament):
        raise ValueError("Another season is already running.")

    # Only ids are needed, so don't build Team instances
    team_ids = list(
        season.teams.filter(tournament=season.tournament)
        .order_by("id")
        .values_list("id", flat=True)
    )
    if len(team_ids) < 2:
        raise ValueError("At least 2 registered teams are required.")

    rounds = round_robin_pairs(team_ids, double_round=double_round)

    matches = [
        Match(season=season, round=round_number, home_id=home_id, away_id=away_id)
        for round_number, round_matches in enumerate(rounds, start=1)
        for home_id, away_id in round_matches
    ]
    Match.objects.bulk_create(matches)

    season.status = "ongoing"
    season.save(update_fields=["status"])
    return len(matches)


# --------------------------------------------------
# STANDINGS
# --------------------------------------------------

def _blank(team, include_logo=True):
    return {
        "team_id": team.id,
        "player_name": team.player_name,
        "club_name": team.club_name,
        "logo": team.logo.url if include_logo and team.logo else None,
        "played": 0,
        "won": 0,
        "drawn": 0,
        "lost": 0,
        "gf": 0,
        "ga": 0,
        "gd": 0,
        "points": 0,
    }


def _apply(row, scored, conceded):
    row["played"] += 1
    row["gf"] += scored
    row["ga"] += conceded
    if scored > conceded:
        row["won"] += 1
        row["points"] += 3
    elif scored == conceded:
        row["drawn"] += 1
        row["points"] += 1
    else:
        row["lost"] += 1


def compute_standings(season, include_logo=True):
    """
    Sorting: points, goal difference, goals scored, player name.
    Pass include_logo=False when logos aren't needed (avoids storage URL lookups).
    """
    table = {t.id: _blank(t, include_logo) for t in season.teams.all()}

    # Plain tuples: no model instances, no ordering needed (sums are order-independent)
    played = season.matches.filter(status="played").values_list(
        "home_id", "away_id", "home_goals", "away_goals"
    )

    for home_id, away_id, home_goals, away_goals in played:
        home = table.get(home_id)
        away = table.get(away_id)
        if home is None or away is None:  # inconsistent roster
            continue
        _apply(home, home_goals, away_goals)
        _apply(away, away_goals, home_goals)

    # gd computed once per team instead of once per match
    for row in table.values():
        row["gd"] = row["gf"] - row["ga"]

    rows = sorted(
        table.values(),
        key=lambda r: (-r["points"], -r["gd"], -r["gf"], r["player_name"].lower()),
    )
    for position, row in enumerate(rows, start=1):
        row["position"] = position
    return rows


def team_form(team, limit=5, season=None):
    """Last N results as W/D/L, oldest first."""
    qs = Match.objects.filter(Q(home=team) | Q(away=team), status="played")
    if season is not None:
        qs = qs.filter(season=season)

    rows = qs.order_by("-round", "-id").values_list(
        "home_id", "home_goals", "away_goals"
    )[:limit]

    results = []
    for home_id, hg, ag in rows:
        mine, theirs = (hg, ag) if home_id == team.id else (ag, hg)
        results.append("W" if mine > theirs else "D" if mine == theirs else "L")

    results.reverse()
    return results


# --------------------------------------------------
# KNOCKOUT: SETUP
# --------------------------------------------------

def _bracket_size(team_count):
    """Smallest power of two >= team_count (integer-exact, no float log2)."""
    return 1 << (team_count - 1).bit_length()


@transaction.atomic
def setup_knockout(season, qualifying_teams, round_legs, third_place_match=False):
    """
    One call for a FINISHED league: validate -> save qualifiers -> build bracket -> create matches.
    If rules were planned earlier, the new rules replace them and the bracket is built.
    """
    planned = KnockoutStage.objects.select_for_update().filter(season=season, status="planned").first()
    if planned:
        _check_knockout_rules(qualifying_teams, round_legs, third_place_match)
        planned.qualifying_teams = qualifying_teams
        planned.round_legs = round_legs
        planned.third_place_match = third_place_match
        planned.save(update_fields=["qualifying_teams", "round_legs", "third_place_match"])
        return activate_planned_knockout(season)

    stage = create_knockout_stage(season, qualifying_teams, round_legs, third_place_match)
    return generate_knockout_bracket(stage)


def get_round_type(teams_in_round):
    names = {2: "final", 4: "semi_final", 8: "quarter_final"}
    return names.get(teams_in_round, f"round_of_{teams_in_round}")


def required_round_types(qualifying_teams, third_place_match=False):
    """e.g. 6 teams -> ['quarter_final', 'semi_final', 'final']."""
    names = []
    size = _bracket_size(qualifying_teams)
    while size >= 2:
        names.append(get_round_type(size))
        size //= 2
    if third_place_match:
        names.append("third_place")
    return names


def legs_for(stage, round_type):
    return stage.round_legs[round_type]


def _check_knockout_rules(qualifying_teams, round_legs, third_place_match):
    """Validate the organizer's choices. Needs no league results, so it works before the league ends."""
    if (isinstance(qualifying_teams, bool) or not isinstance(qualifying_teams, int)
            or qualifying_teams < 2):
        raise ValueError("At least 2 qualifying teams are required.")

    if qualifying_teams > MAX_KNOCKOUT_TEAMS:
        raise ValueError(f"At most {MAX_KNOCKOUT_TEAMS} teams can qualify.")

    if not isinstance(third_place_match, bool):
        raise ValueError("Third-place match must be true or false.")

    if third_place_match and qualifying_teams < 4:
        raise ValueError("A third-place match needs at least 4 qualifying teams.")

    needed = required_round_types(qualifying_teams, third_place_match)
    if not isinstance(round_legs, dict) or set(round_legs) != set(needed):
        raise ValueError(f"Give legs (1 or 2) for exactly these rounds: {', '.join(needed)}.")
    if any(isinstance(v, bool) or v not in (1, 2) for v in round_legs.values()):
        raise ValueError("Each round must have either 1 or 2 legs.")


@transaction.atomic
def create_knockout_stage(season, qualifying_teams, round_legs, third_place_match=False):
    """Validate the user's choices and store the top N teams of the league table."""

    if season.status != "finished":
        raise ValueError("The league season must be finished before creating knockouts.")

    _check_knockout_rules(qualifying_teams, round_legs, third_place_match)

    if KnockoutStage.objects.filter(season=season).exists():
        raise ValueError("A knockout stage already exists for this season.")

    # One query replaces exists() + count()
    counts = season.matches.aggregate(
        total=Count("id"),
        unplayed=Count("id", filter=~Q(status="played")),
    )
    if not counts["total"]:
        raise ValueError("League fixtures have not been generated.")
    if counts["unplayed"]:
        raise ValueError(f"{counts['unplayed']} league matches are still unfinished.")

    standings = compute_standings(season, include_logo=False)
    if qualifying_teams > len(standings):
        raise ValueError(f"Only {len(standings)} teams are available for qualification.")

    stage = KnockoutStage.objects.create(
        season=season,
        qualifying_teams=qualifying_teams,
        round_legs=round_legs,
        third_place_match=third_place_match,
        status="setup",
    )

    KnockoutEntry.objects.bulk_create([
        KnockoutEntry(stage=stage, team_id=row["team_id"], seed=row["position"])
        for row in standings[:qualifying_teams]
    ])
    return stage


@transaction.atomic
def reset_knockout(stage):
    """Delete the knockout so it can be set up again."""
    if KnockoutMatch.objects.filter(tie__stage=stage, status="played").exists():
        raise ValueError("Knockout matches have already been played, so it can't be reset.")
    stage.delete()


# --------------------------------------------------
# KNOCKOUT: SET THE RULES NOW, BUILD WHEN THE LEAGUE ENDS
# --------------------------------------------------

@transaction.atomic
def plan_knockout(season, qualifying_teams, round_legs, third_place_match=False):
    """
    Save the knockout rules while the league is still being played.
    The bracket is built automatically when the league ends (see finish_league_if_complete).
    Calling this again replaces the rules of a plan that has not been built yet.
    """
    if season.status == "finished":
        raise ValueError("The league is already finished, so the knockout is created directly.")

    _check_knockout_rules(qualifying_teams, round_legs, third_place_match)

    team_count = season.teams.count()
    if qualifying_teams > team_count:
        raise ValueError(f"Only {team_count} teams are in this season.")

    stage = KnockoutStage.objects.select_for_update().filter(season=season).first()
    if stage is None:
        return KnockoutStage.objects.create(
            season=season,
            qualifying_teams=qualifying_teams,
            round_legs=round_legs,
            third_place_match=third_place_match,
            status="planned",
        )
    if stage.status != "planned":
        raise ValueError("A knockout stage already exists for this season.")

    stage.qualifying_teams = qualifying_teams
    stage.round_legs = round_legs
    stage.third_place_match = third_place_match
    stage.save(update_fields=["qualifying_teams", "round_legs", "third_place_match"])
    return stage


@transaction.atomic
def activate_planned_knockout(season):
    """
    Turn a planned knockout into a real bracket from the final league table.
    Returns the stage, or None when nothing is planned.
    """
    stage = KnockoutStage.objects.select_for_update().filter(season=season, status="planned").first()
    if stage is None:
        return None
    if season.status != "finished":
        raise ValueError("The league must be finished first.")

    standings = compute_standings(season, include_logo=False)
    if stage.qualifying_teams > len(standings):
        raise ValueError(f"Only {len(standings)} teams are available for qualification.")

    KnockoutEntry.objects.bulk_create([
        KnockoutEntry(stage=stage, team_id=row["team_id"], seed=row["position"])
        for row in standings[:stage.qualifying_teams]
    ])
    stage.status = "setup"
    stage.save(update_fields=["status"])
    return generate_knockout_bracket(stage)


@transaction.atomic
def finish_league_if_complete(season):
    """
    Call after a league score is saved. When a knockout is planned, the season is running and every
    league match is played, this ends the season and builds the knockout.
    Returns the new stage, or None when nothing happened.
    """
    if season.status != "ongoing":
        return None
    if not KnockoutStage.objects.filter(season=season, status="planned").exists():
        return None
    if not season.matches.exists() or season.matches.exclude(status="played").exists():
        return None

    season.status = "finished"
    season.save(update_fields=["status"])
    return activate_planned_knockout(season)


# --------------------------------------------------
# KNOCKOUT: BRACKET
# --------------------------------------------------

def get_seed_order(size):
    """Standard seeding, e.g. 8 -> [1, 8, 4, 5, 2, 7, 3, 6]."""
    order = [1, 2]
    while len(order) < size:
        next_size = len(order) * 2
        order = [s for cur in order for s in (cur, next_size + 1 - cur)]
    return order


def create_knockout_matches(tie, legs_per_tie):
    """Create the legs of a tie once both teams are known. Leg 2 swaps venues."""
    if not tie.home_id or not tie.away_id:
        return
    if tie.home_id == tie.away_id:
        raise ValueError("A team cannot play against itself.")
    if tie.matches.exists():
        return

    KnockoutMatch.objects.bulk_create([
        KnockoutMatch(
            tie=tie,
            leg_number=leg,
            home_id=tie.home_id if leg % 2 == 1 else tie.away_id,
            away_id=tie.away_id if leg % 2 == 1 else tie.home_id,
        )
        for leg in range(1, legs_per_tie + 1)
    ])


@transaction.atomic
def generate_knockout_bracket(stage):
    """
    Build the whole bracket from the stage settings.
    Rounded up to a power of two; top seeds get byes. Round-1 matches are
    created immediately, later rounds as empty ties.
    """

    if stage.status != "setup":
        raise ValueError("Bracket can only be generated while the stage is in setup.")
    if stage.ties.exists():
        raise ValueError("The knockout bracket has already been generated.")

    entries = list(stage.entries.select_related("team").order_by("seed"))
    team_count = len(entries)

    if team_count != stage.qualifying_teams:
        raise ValueError("Qualified teams do not match the stage configuration.")
    if team_count < 2:
        raise ValueError("At least two qualified teams are required.")

    bracket_size = _bracket_size(team_count)
    teams_by_seed = {e.seed: e.team for e in entries}
    seed_order = get_seed_order(bracket_size)

    # ---- Round 1 ----
    first_round_type = get_round_type(bracket_size)
    current = [
        KnockoutTie.objects.create(
            stage=stage,
            round_number=1,
            round_type=first_round_type,
            tie_number=i // 2 + 1,
            home=teams_by_seed.get(seed_order[i]),
            away=teams_by_seed.get(seed_order[i + 1]),
        )
        for i in range(0, bracket_size, 2)
    ]
    first_round = list(current)

    # ---- Later rounds ----
    teams_in_round = bracket_size // 2
    round_number = 2

    while teams_in_round >= 2:
        round_type = get_round_type(teams_in_round)
        next_round = []

        for i in range(0, len(current), 2):
            tie = KnockoutTie.objects.create(
                stage=stage,
                round_number=round_number,
                round_type=round_type,
                tie_number=i // 2 + 1,
            )
            current[i].next_tie, current[i].winner_slot = tie, "home"
            current[i + 1].next_tie, current[i + 1].winner_slot = tie, "away"
            next_round.append(tie)

        if round_type == "final" and stage.third_place_match:
            third = KnockoutTie.objects.create(
                stage=stage,
                round_number=round_number,
                round_type="third_place",
                tie_number=1,
            )
            current[0].loser_next_tie, current[0].loser_slot = third, "home"
            current[1].loser_next_tie, current[1].loser_slot = third, "away"

        # One UPDATE batch per round instead of one save() per feeder
        KnockoutTie.objects.bulk_update(
            current, ["next_tie", "winner_slot", "loser_next_tie", "loser_slot"]
        )

        current = next_round
        teams_in_round //= 2
        round_number += 1

    # ---- Round-1 matches; advance byes ----
    for tie in first_round:
        if tie.home_id and tie.away_id:
            create_knockout_matches(tie, legs_for(stage, tie.round_type))
        else:
            _propagate(tie, tie.home or tie.away)

    stage.status = "ongoing"
    stage.save(update_fields=["status"])
    return stage


# --------------------------------------------------
# KNOCKOUT: RESULTS & PROGRESSION
# --------------------------------------------------

def _totals(tie, matches):
    """(tie.home total, tie.away total) over played legs."""
    home_total = away_total = 0
    for m in matches:
        if m.status != "played":
            continue
        if m.home_id == tie.home_id:
            home_total += m.home_goals
            away_total += m.away_goals
        else:
            home_total += m.away_goals
            away_total += m.home_goals
    return home_total, away_total


def tie_totals(tie, matches=None):
    return _totals(tie, tie.matches.all() if matches is None else matches)


def tie_needs_penalties(tie, matches):
    if not matches or any(m.status != "played" for m in matches):
        return False
    h, a = _totals(tie, matches)
    last = matches[-1]
    return h == a and (last.home_pens is None or last.away_pens is None)


def evaluate_tie(tie, matches=None):
    """
    Winning Team, or None if undecided. Aggregate goals (no away-goals rule),
    then penalties on the last leg. Pass `matches` (ordered by leg_number)
    to avoid re-querying.
    """
    if matches is None:
        matches = list(tie.matches.order_by("leg_number"))
    if not matches or any(m.status != "played" for m in matches):
        return None

    h, a = _totals(tie, matches)
    if h != a:
        return tie.home if h > a else tie.away

    last = matches[-1]
    if last.home_pens is None or last.away_pens is None:
        return None
    return last.home if last.home_pens > last.away_pens else last.away


def _set_slot(tie_id, slot, team):
    """Put a team (or None) in a slot of a later tie and rebuild its legs."""
    tie = KnockoutTie.objects.select_for_update().select_related("stage").get(pk=tie_id)

    if tie.matches.filter(status="played").exists():
        raise ValueError(
            "Can't change this result: the next round already has played matches. "
            "Clear those scores first."
        )

    tie.matches.all().delete()
    setattr(tie, slot, team)
    tie.save(update_fields=[slot])

    if tie.home_id and tie.away_id:
        create_knockout_matches(tie, legs_for(tie.stage, tie.round_type))


def _propagate(tie, winner):
    """Record a tie's winner (or clear it) and move winner/loser onward."""
    tie.winner = winner
    tie.save(update_fields=["winner"])

    if tie.next_tie_id:
        _set_slot(tie.next_tie_id, tie.winner_slot, winner)

    if tie.loser_next_tie_id:
        loser = None
        if winner is not None:
            loser = tie.away if winner.id == tie.home_id else tie.home
        _set_slot(tie.loser_next_tie_id, tie.loser_slot, loser)

    _refresh_stage(tie.stage_id)


def _refresh_stage(stage_id):
    """Finished when every tie has a winner; champion is the final's winner."""
    ties = KnockoutTie.objects.filter(stage_id=stage_id)
    if ties.filter(winner__isnull=True).exists():
        KnockoutStage.objects.filter(pk=stage_id).update(status="ongoing", champion=None)
    else:
        champion_id = (
            ties.filter(round_type="final").values_list("winner_id", flat=True).first()
        )
        KnockoutStage.objects.filter(pk=stage_id).update(
            status="finished", champion_id=champion_id
        )


@transaction.atomic
def record_knockout_score(match_id, home_goals, away_goals, home_pens=None, away_pens=None):
    """
    Save a leg's result (replaced each time). None/None clears it.
    Penalties only on the last leg when the tie is level on aggregate.
    Advances the winner automatically when the tie is decided.
    """

    match = KnockoutMatch.objects.select_for_update().get(pk=match_id)
    tie = (KnockoutTie.objects.select_for_update()
           .select_related("stage", "home", "away", "winner").get(pk=match.tie_id))

    if tie.stage.status == "setup":
        raise ValueError("The bracket has not been generated yet.")

    if home_goals is None:
        home_pens = away_pens = None

    match.home_goals, match.away_goals = home_goals, away_goals
    match.home_pens, match.away_pens = home_pens, away_pens
    match.save()

    # Fetch the legs ONCE and reuse for totals + evaluation
    legs = list(tie.matches.select_related("home", "away").order_by("leg_number"))
    h, a = _totals(tie, legs)

    if home_pens is not None:
        if match.leg_number != legs_for(tie.stage, tie.round_type):
            raise ValueError("Penalties can only be entered on the last leg.")
        if h != a:
            raise ValueError("Penalties only apply when the tie is level on aggregate.")
        if home_pens == away_pens:
            raise ValueError("A penalty shoot-out needs a winner.")

    # Drop stale shoot-out data if the aggregate is no longer level
    if h != a:
        stale = [m for m in legs if m.home_pens is not None or m.away_pens is not None]
        if stale:
            tie.matches.filter(pk__in=[m.pk for m in stale]).update(
                home_pens=None, away_pens=None
            )
            for m in stale:
                m.home_pens = m.away_pens = None

    new_winner = evaluate_tie(tie, legs)
    if (new_winner.id if new_winner else None) != tie.winner_id:
        _propagate(tie, new_winner)

    return tie