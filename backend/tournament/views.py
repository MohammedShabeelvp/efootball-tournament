from django.contrib.auth import authenticate
from django.db.models import Prefetch, prefetch_related_objects
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.authtoken.models import Token
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import KnockoutMatch, KnockoutStage, Match, Season, Team, Tournament
from .permissions import HasRole, RoleOrReadOnly, role_of
from .serializers import (
    KnockoutMatchScoreSerializer,
    KnockoutSetupSerializer,
    KnockoutStageSerializer,
    KnockoutTieSerializer,
    MatchScoreSerializer,
    MatchSerializer,
    SeasonSerializer,
    TeamDetailSerializer,
    TeamSerializer,
    TournamentSerializer,
)
from .services import (
    ResultsWouldBeLost,
    compute_standings,
    create_season,
    end_season,
    generate_fixtures,
    record_knockout_score,
    reset_knockout,
    scrap_season,
    season_running,
    setup_knockout,
)


# ---------- helpers ----------

def _flag(request, name, default=False):
    """Read an optional boolean from the request body."""
    value = request.data.get(name, default)
    if not isinstance(value, bool):
        raise ValidationError({name: "Must be true or false."})
    return value


def _bad_request(error):
    return Response({"detail": str(error)}, status=400)


# ---------- auth ----------

class LoginView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        user = authenticate(
            username=str(request.data.get("username", "")),
            password=str(request.data.get("password", "")),
        )
        if user is None:
            return Response({"detail": "Invalid username or password."}, status=400)

        role = role_of(user)
        if role is None:
            return Response(
                {"detail": "This account has no admin or organizer access."}, status=403
            )

        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "username": user.username, "role": role})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if request.auth:
            request.auth.delete()
        return Response(status=204)


class MeView(APIView):
    permission_classes = [HasRole]

    def get(self, request):
        return Response({"username": request.user.username, "role": role_of(request.user)})


# ---------- tournaments ----------

class TournamentList(generics.ListCreateAPIView):
    serializer_class = TournamentSerializer
    permission_classes = [RoleOrReadOnly]

    def get_queryset(self):
        # Counts and season_running come from one annotated query
        return TournamentSerializer.setup_eager_loading(Tournament.objects.all())


class TournamentDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TournamentSerializer
    permission_classes = [RoleOrReadOnly]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return TournamentSerializer.setup_eager_loading(Tournament.objects.all())

    def perform_destroy(self, instance):
        if role_of(self.request.user) != "admin":
            raise PermissionDenied("Only an admin can delete a tournament.")
        instance.delete()


class TournamentTeams(generics.ListCreateAPIView):
    serializer_class = TeamSerializer
    permission_classes = [RoleOrReadOnly]

    def get_queryset(self):
        # TeamSerializer doesn't touch the tournament, so no join needed
        return Team.objects.filter(tournament_id=self.kwargs["pk"])

    def perform_create(self, serializer):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        name = serializer.validated_data["player_name"]

        if tournament.teams.filter(player_name__iexact=name).exists():
            raise ValidationError(
                {"player_name": "This player is already in the tournament."}
            )

        # New teams cannot join a running season
        extra = {"is_active": False} if season_running(tournament) else {}
        serializer.save(tournament=tournament, **extra)


class TournamentSeasons(generics.ListCreateAPIView):
    serializer_class = SeasonSerializer
    permission_classes = [RoleOrReadOnly]

    def get_queryset(self):
        # Newest first, so the current season is always on top
        return SeasonSerializer.setup_eager_loading(
            Season.objects.filter(tournament_id=self.kwargs["pk"]).order_by("-number")
        )

    def create(self, request, *args, **kwargs):
        tournament = get_object_or_404(Tournament, pk=kwargs["pk"])
        try:
            season = create_season(tournament)
        except ValueError as e:
            raise ValidationError(str(e))
        return Response(SeasonSerializer(season).data, status=201)


# ---------- season operations ----------

class StandingsView(APIView):
    def get(self, request, pk):
        season = get_object_or_404(Season, pk=pk)
        return Response(compute_standings(season))


class FixturesView(APIView):
    def get(self, request, pk):
        get_object_or_404(Season, pk=pk)  # 404 for unknown seasons

        # MatchSerializer doesn't use the season, so don't join it
        qs = (
            Match.objects.filter(season_id=pk)
            .select_related("home", "away")
            .order_by("round", "scheduled_at", "id")
        )

        round_no = request.query_params.get("round")
        if round_no:
            if not round_no.isdigit():
                raise ValidationError({"round": "Round must be a positive integer."})
            qs = qs.filter(round=int(round_no))

        return Response(MatchSerializer(qs, many=True).data)


class GenerateFixturesView(APIView):
    """Admin/organizer. Body: {"double_round": true|false}"""

    permission_classes = [HasRole]

    def post(self, request, pk):
        season = get_object_or_404(Season, pk=pk)
        double_round = _flag(request, "double_round")

        try:
            count = generate_fixtures(season, double_round=double_round)
        except ValueError as e:
            return _bad_request(e)

        return Response(
            {"season": season.id, "created": count, "double_round": double_round},
            status=201,
        )


class EndSeasonView(APIView):
    permission_classes = [HasRole]

    def post(self, request, pk):
        season = get_object_or_404(Season, pk=pk)
        force = _flag(request, "force")

        try:
            end_season(season, force=force)
        except ValueError as e:
            return _bad_request(e)

        return Response(SeasonSerializer(season).data)


class SeasonDetail(APIView):
    """
    DELETE /seasons/<id>/            scrap a season that has no results
    DELETE /seasons/<id>/?force=true scrap it even though matches were played (admin only)
    """

    permission_classes = [HasRole]

    def delete(self, request, pk):
        season = get_object_or_404(Season, pk=pk)
        force = request.query_params.get("force", "").lower() == "true"

        if force and role_of(request.user) != "admin":
            raise PermissionDenied("Only an admin can scrap a season that has results.")

        try:
            summary = scrap_season(season, force=force)
        except ResultsWouldBeLost as e:
            # 409 = "needs confirmation", so the UI can offer the forced option
            return Response({"detail": str(e)}, status=409)
        except ValueError as e:
            return _bad_request(e)

        return Response(summary)


# ---------- teams & matches ----------

class TeamDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Team.objects.select_related("tournament")
    permission_classes = [RoleOrReadOnly]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_serializer_class(self):
        return TeamDetailSerializer if self.request.method == "GET" else TeamSerializer

    def perform_update(self, serializer):
        team = serializer.instance  # already loaded: no second get_object()
        name = serializer.validated_data.get("player_name")
        if name and (
            Team.objects.filter(tournament_id=team.tournament_id, player_name__iexact=name)
            .exclude(pk=team.pk)
            .exists()
        ):
            raise ValidationError({"player_name": "This player is already in the tournament."})
        serializer.save()

    def perform_destroy(self, instance):
        if instance.seasons.exists():
            raise ValidationError("This team has played in a season. Set it inactive instead.")
        instance.delete()


class MatchScoreView(generics.UpdateAPIView):
    """PATCH {"home_goals": 2, "away_goals": 1}; send both as null to clear."""

    queryset = Match.objects.select_related("home", "away")
    serializer_class = MatchScoreSerializer
    permission_classes = [HasRole]
    http_method_names = ["patch", "options"]

    def update(self, request, *args, **kwargs):
        # Load once and reuse the instance for the response
        # (previously get_object() ran twice).
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(MatchSerializer(instance).data)


# ---------- knockout ----------

class SeasonKnockoutView(APIView):
    """
    GET    /seasons/<id>/knockout/   bracket (rounds -> ties -> legs)
    POST   /seasons/<id>/knockout/
           {"qualifying_teams": 6,
            "round_legs": {"quarter_final": 1, "semi_final": 2, "final": 1},
            "third_place_match": false}
    DELETE /seasons/<id>/knockout/   reset (only if no knockout match has been played)
    """

    permission_classes = [RoleOrReadOnly]

    NOT_FOUND = {"detail": "No knockout stage for this season."}

    def _stage(self, pk):
        """One query; no separate season lookup needed for GET/DELETE."""
        return KnockoutStageSerializer.setup_eager_loading(
            KnockoutStage.objects.filter(season_id=pk)
        ).first()

    def get(self, request, pk):
        stage = self._stage(pk)
        if stage is None:
            return Response(self.NOT_FOUND, status=404)
        return Response(KnockoutStageSerializer(stage).data)

    def post(self, request, pk):
        season = get_object_or_404(Season, pk=pk)

        data = KnockoutSetupSerializer(data=request.data)
        data.is_valid(raise_exception=True)

        try:
            stage = setup_knockout(season, **data.validated_data)
        except ValueError as e:
            return _bad_request(e)

        return Response(KnockoutStageSerializer(stage).data, status=201)

    def delete(self, request, pk):
        stage = KnockoutStage.objects.filter(season_id=pk).first()
        if stage is None:
            return Response(self.NOT_FOUND, status=404)
        try:
            reset_knockout(stage)
        except ValueError as e:
            return _bad_request(e)
        return Response(status=204)


class KnockoutMatchScoreView(APIView):
    """
    PATCH /knockout/matches/<id>/score/
    {"home_goals": 1, "away_goals": 1, "home_pens": 4, "away_pens": 3}
    Penalties are optional. Send null goals to clear the result.
    Returns the updated tie (winner is advanced automatically).
    """

    permission_classes = [HasRole]

    def patch(self, request, pk):
        data = KnockoutMatchScoreSerializer(data=request.data)
        data.is_valid(raise_exception=True)

        try:
            tie = record_knockout_score(pk, **data.validated_data)
        except KnockoutMatch.DoesNotExist:
            return Response({"detail": "Match not found."}, status=404)
        except ValueError as e:
            return _bad_request(e)

        # The returned tie already has stage/home/away/winner loaded and is
        # current, so only the legs need fetching (no full tie re-query).
        prefetch_related_objects(
            [tie],
            Prefetch(
                "matches",
                queryset=KnockoutMatch.objects.select_related("home", "away")
                .order_by("leg_number"),
            ),
        )
        return Response(KnockoutTieSerializer(tie).data)