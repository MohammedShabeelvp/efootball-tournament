from django.contrib import admin
from .models import Tournament, Team, Season, Match


@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = ("name", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("name",)


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = (
        "player_name",
        "club_name",
        "tournament",
        "is_active",
    )
    list_filter = ("tournament", "is_active")
    search_fields = ("player_name", "club_name", "efootball_id")


@admin.register(Season)
class SeasonAdmin(admin.ModelAdmin):
    list_display = (
        "number",
        "tournament",
        "status",
        "created_at",
    )
    list_filter = ("tournament", "status")
    search_fields = ("tournament__name",)


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "get_tournament",
        "season",
        "round",
        "home",
        "away",
        "home_goals",
        "away_goals",
        "status",
        "scheduled_at",
    )

    list_filter = (
        "season__tournament",
        "season",
        "status",
        "round",
    )

    search_fields = (
        "home__player_name",
        "away__player_name",
        "home__club_name",
        "away__club_name",
    )

    @admin.display(description="Tournament", ordering="season__tournament__name")
    def get_tournament(self, obj):
        return obj.season.tournament