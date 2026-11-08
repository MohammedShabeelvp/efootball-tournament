from rest_framework.permissions import SAFE_METHODS, BasePermission

ORGANIZER_GROUP = "Organizer"


def role_of(user):
    """'admin' (superuser), 'organizer' (member of the Organizer group) or None."""
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return "admin"
    if user.groups.filter(name=ORGANIZER_GROUP).exists():
        return "organizer"
    return None


class HasRole(BasePermission):
    """Admin or organizer only."""

    def has_permission(self, request, view):
        return role_of(request.user) is not None


class RoleOrReadOnly(BasePermission):
    """Anyone can read; only admin/organizer can write."""

    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or role_of(request.user) is not None
