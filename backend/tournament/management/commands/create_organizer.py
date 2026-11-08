from getpass import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from tournament.permissions import ORGANIZER_GROUP


class Command(BaseCommand):
    help = "Create an Organizer account (can create tournaments/teams and enter scores)."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--password", help="If omitted you will be prompted.")

    def handle(self, *args, **opts):
        User = get_user_model()
        if User.objects.filter(username=opts["username"]).exists():
            raise CommandError("That username already exists.")
        password = opts["password"] or getpass("Password: ")
        try:
            validate_password(password)
        except ValidationError as e:
            raise CommandError(" ".join(e.messages))
        user = User.objects.create_user(opts["username"], password=password)
        group, _ = Group.objects.get_or_create(name=ORGANIZER_GROUP)
        user.groups.add(group)
        self.stdout.write(self.style.SUCCESS(f"Organizer '{user.username}' created."))
