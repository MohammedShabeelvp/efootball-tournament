from django.apps import AppConfig
from django.db.models.signals import post_migrate


def create_roles(sender, **kwargs):
    from django.contrib.auth.models import Group

    from .permissions import ORGANIZER_GROUP

    Group.objects.get_or_create(name=ORGANIZER_GROUP)


class TournamentConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "tournament"

    def ready(self):
        post_migrate.connect(create_roles, sender=self)
