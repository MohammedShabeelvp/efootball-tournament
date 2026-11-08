from django.urls import path

from . import views

urlpatterns = [
    # Authentication
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("auth/logout/", views.LogoutView.as_view(), name="logout"),
    path("auth/me/", views.MeView.as_view(), name="me"),

    # Tournaments
    path("tournaments/", views.TournamentList.as_view(), name="tournament-list"),
    path("tournaments/<int:pk>/", views.TournamentDetail.as_view(), name="tournament-detail"),
    path("tournaments/<int:pk>/seasons/", views.TournamentSeasons.as_view(), name="tournament-seasons"),
    path("tournaments/<int:pk>/teams/", views.TournamentTeams.as_view(), name="tournament-teams"),

    # Season operations
    path("seasons/<int:pk>/", views.SeasonDetail.as_view(), name="season-detail"),
    path("seasons/<int:pk>/standings/", views.StandingsView.as_view(), name="season-standings"),
    path("seasons/<int:pk>/fixtures/", views.FixturesView.as_view(), name="season-fixtures"),
    path("seasons/<int:pk>/generate-fixtures/", views.GenerateFixturesView.as_view(), name="generate-fixtures"),
    path("seasons/<int:pk>/end/", views.EndSeasonView.as_view(), name="end-season"),
    path("seasons/<int:pk>/knockout/", views.SeasonKnockoutView.as_view(), name="season-knockout"),

    # Teams
    path("teams/<int:pk>/", views.TeamDetail.as_view(), name="team-detail"),

    # Matches
    path("matches/<int:pk>/", views.MatchScoreView.as_view(), name="match-detail"),
    path("knockout/matches/<int:pk>/score/", views.KnockoutMatchScoreView.as_view(), name="knockout-match-score"),
]