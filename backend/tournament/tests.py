import io
import tempfile

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from .models import Match, Team, Tournament, Season
from .services import compute_standings, generate_fixtures, round_robin_pairs


class FixtureTests(TestCase):
    def test_single_round_even(self):
        rounds = round_robin_pairs([1, 2, 3, 4])
        self.assertEqual(len(rounds), 3)
        pairs = {frozenset(p) for r in rounds for p in r}
        self.assertEqual(len(pairs), 6)

    def test_odd_teams_get_byes(self):
        rounds = round_robin_pairs([1, 2, 3, 4, 5])
        self.assertEqual(sum(len(r) for r in rounds), 10)
        for r in rounds:
            ids = [x for p in r for x in p]
            self.assertEqual(len(ids), len(set(ids)))

    def test_double_round(self):
        rounds = round_robin_pairs([1, 2, 3, 4], double_round=True)
        flat = [p for r in rounds for p in r]
        self.assertEqual(len(flat), 12)
        self.assertEqual(len(set(flat)), 12)  # every (home, away) ordered pair unique


class StandingsTests(TestCase):
    def setUp(self):
        self.t = Tournament.objects.create(name="Cup")
        self.a, self.b, self.c = (Team.objects.create(tournament=self.t, player_name=n, club_name=n)
                                  for n in "ABC")

    def test_table_and_ordering(self):
        Match.objects.create(tournament=self.t, round=1, home=self.a, away=self.b, home_goals=3, away_goals=0)
        Match.objects.create(tournament=self.t, round=2, home=self.b, away=self.c, home_goals=1, away_goals=1)
        Match.objects.create(tournament=self.t, round=3, home=self.c, away=self.a)  # unplayed
        rows = compute_standings(self.t)
        self.assertEqual([r["player_name"] for r in rows], ["A", "C", "B"])
        self.assertEqual(rows[0]["points"], 3)
        self.assertEqual(rows[0]["gd"], 3)
        self.assertEqual(rows[2]["points"], 1)
        self.assertEqual(rows[2]["gd"], -3)

    def test_generate_refuses_twice(self):
        generate_fixtures(self.t)
        with self.assertRaises(ValueError):
            generate_fixtures(self.t)


def png(name="a.png"):
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "green").save(buf, "PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class ApiTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_superuser("admin", password="pw-Admin-123")
        self.org = User.objects.create_user("org", password="pw-Org-12345")
        self.org.groups.add(Group.objects.get_or_create(name="Organizer")[0])
        self.nobody = User.objects.create_user("nobody", password="pw-None-1234")
        self.t = Tournament.objects.create(name="Cup")
        for n in "ABCD":
            Team.objects.create(tournament=self.t, player_name=n, club_name=n)
        self.c = APIClient()

    def as_(self, user):
        self.c.force_authenticate(user)
        return self.c

    # --- public reads ---
    def test_public_reads(self):
        generate_fixtures(self.t)
        self.assertEqual(self.c.get("/api/tournaments/").status_code, 200)
        self.assertEqual(len(self.c.get(f"/api/tournaments/{self.t.id}/standings/").json()), 4)
        self.assertEqual(len(self.c.get(f"/api/tournaments/{self.t.id}/fixtures/?round=1").json()), 2)

    def test_team_details_fields(self):
        generate_fixtures(self.t)
        m = self.t.matches.first()
        m.home_goals, m.away_goals = 2, 1
        m.save()
        d = self.c.get(f"/api/teams/{m.home_id}/").json()
        self.assertEqual(d["stats"]["played"], 1)
        self.assertEqual(d["matches_total"], 3)
        self.assertEqual(d["career_played"], 1)
        self.assertEqual(d["form"], ["W"])
        self.assertIn("lineup_image", d)

    def test_career_played_spans_tournaments(self):
        t2 = Tournament.objects.create(name="Cup 2")
        a2 = Team.objects.create(tournament=t2, player_name="a", club_name="X")
        b2 = Team.objects.create(tournament=t2, player_name="Z", club_name="Z")
        Match.objects.create(tournament=t2, round=1, home=a2, away=b2, home_goals=1, away_goals=0)
        a1 = self.t.teams.get(player_name="A")
        Match.objects.create(tournament=self.t, round=1, home=a1, away=self.t.teams.get(player_name="B"),
                             home_goals=0, away_goals=0)
        self.assertEqual(self.c.get(f"/api/teams/{a1.id}/").json()["career_played"], 2)

    # --- auth ---
    def test_login(self):
        ok = self.c.post("/api/auth/login/", {"username": "org", "password": "pw-Org-12345"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["role"], "organizer")
        admin = self.c.post("/api/auth/login/", {"username": "admin", "password": "pw-Admin-123"}, format="json")
        self.assertEqual(admin.json()["role"], "admin")
        bad = self.c.post("/api/auth/login/", {"username": "org", "password": "nope"}, format="json")
        self.assertEqual(bad.status_code, 400)
        norole = self.c.post("/api/auth/login/", {"username": "nobody", "password": "pw-None-1234"}, format="json")
        self.assertEqual(norole.status_code, 403)

    def test_token_works_and_logout_revokes(self):
        tok = self.c.post("/api/auth/login/", {"username": "org", "password": "pw-Org-12345"},
                          format="json").json()["token"]
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION=f"Token {tok}")
        self.assertEqual(c.get("/api/auth/me/").json()["role"], "organizer")
        self.assertEqual(c.post("/api/auth/logout/").status_code, 204)
        self.assertEqual(c.get("/api/auth/me/").status_code, 401)

    # --- permissions ---
    def test_anonymous_and_norole_cannot_write(self):
        self.assertEqual(self.c.post("/api/tournaments/", {"name": "X"}, format="json").status_code, 401)
        self.as_(self.nobody)
        self.assertEqual(self.c.post("/api/tournaments/", {"name": "X"}, format="json").status_code, 403)
        url = f"/api/tournaments/{self.t.id}/generate-fixtures/"
        self.assertEqual(self.c.post(url).status_code, 403)

    def test_organizer_creates_tournament_and_team_with_images(self):
        self.as_(self.org)
        r = self.c.post("/api/tournaments/", {"name": "New Cup"}, format="json")
        self.assertEqual(r.status_code, 201)
        tid = r.json()["id"]
        r = self.c.post(f"/api/tournaments/{tid}/teams/",
                        {"club_name": "Barca", "player_name": "Ahmed", "efootball_id": "123",
                         "lineup_image": png("l.png"), "logo": png("g.png")}, format="multipart")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(r.json()["lineup_image"].startswith("/media/lineups/"))
        dup = self.c.post(f"/api/tournaments/{tid}/teams/",
                          {"club_name": "Other", "player_name": "ahmed"}, format="multipart")
        self.assertEqual(dup.status_code, 400)

    def test_rejects_non_image_upload(self):
        self.as_(self.org)
        bad = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        r = self.c.post(f"/api/tournaments/{self.t.id}/teams/",
                        {"club_name": "C", "player_name": "New", "lineup_image": bad}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_team_added_mid_season_is_inactive_and_locked(self):
        season = Season.objects.create(tournament=self.t, number=1)
        self.as_(self.org)
        generate_fixtures(season)                     # season is now ongoing
        r = self.c.post(f"/api/tournaments/{self.t.id}/teams/",
                        {"club_name": "C", "player_name": "Late"}, format="multipart")
        self.assertEqual(r.status_code, 201)
        self.assertFalse(r.json()["is_active"])
        r = self.c.patch(f"/api/teams/{r.json()['id']}/", {"is_active": True}, format="json")
        self.assertEqual(r.status_code, 400)   
               # locked until the season ends
    def test_only_admin_deletes_tournament(self):
        self.as_(self.org)
        self.assertEqual(self.c.delete(f"/api/tournaments/{self.t.id}/").status_code, 403)
        self.as_(self.admin)
        self.assertEqual(self.c.delete(f"/api/tournaments/{self.t.id}/").status_code, 204)

    def test_score_entry(self):
        generate_fixtures(self.t)
        m = self.t.matches.first()
        self.assertEqual(self.c.patch(f"/api/matches/{m.id}/", {"home_goals": 1, "away_goals": 0}, format="json").status_code, 401)
        self.as_(self.org)
        r = self.c.patch(f"/api/matches/{m.id}/", {"home_goals": 3, "away_goals": 2}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "played")
        half = self.c.patch(f"/api/matches/{m.id}/", {"home_goals": None}, format="json")
        self.assertEqual(half.status_code, 400)
        clear = self.c.patch(f"/api/matches/{m.id}/", {"home_goals": None, "away_goals": None}, format="json")
        self.assertEqual(clear.json()["status"], "scheduled")
        neg = self.c.patch(f"/api/matches/{m.id}/", {"home_goals": -1, "away_goals": 0}, format="json")
        self.assertEqual(neg.status_code, 400)
