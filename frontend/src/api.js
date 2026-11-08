import { useCallback, useEffect, useRef, useState } from "react";

const AUTH_KEY = "efootball_auth";

const newestFirst = (seasons) => [...seasons].sort((a, b) => b.number - a.number);

// ----------------------------------
// AUTHENTICATION STORAGE
// ----------------------------------

export const getAuth = () => {
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

export const setAuth = (auth) => {
  if (auth) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
};

// ----------------------------------
// ERROR HANDLING
// ----------------------------------

function flatten(data) {
  if (!data) return "";

  if (typeof data === "string") return data;

  if (Array.isArray(data)) {
    return data.map(flatten).join(" ");
  }

  if (typeof data === "object") {
    return Object.entries(data)
      .map(([key, value]) => {
        const message = flatten(value);

        return key === "detail" || key === "non_field_errors"
          ? message
          : `${key}: ${message}`;
      })
      .join(" ");
  }

  return String(data);
}

// ----------------------------------
// BASE API REQUEST
// ----------------------------------

async function request(path, { method = "GET", body } = {}) {
  const headers = {};

  const auth = getAuth();

  if (auth?.token) {
    headers.Authorization = `Token ${auth.token}`;
  }

  let payload;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
  });

  if (res.status === 204) return null;

  let data = null;

  try {
    data = await res.json();
  } catch {
    // Response has no JSON body
  }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      setAuth(null);

      window.dispatchEvent(new Event("auth-expired"));

      // Retry public GET requests without authentication
      if (method === "GET") {
        return request(path, { method, body });
      }
    }

    const error = new Error(flatten(data) || `Request failed (${res.status})`);

    error.status = res.status;

    throw error;
  }

  return data;
}

// ----------------------------------
// API ENDPOINTS
// ----------------------------------

export const api = {
  // PUBLIC

  tournaments: () => request("/tournaments/"),

  tournament: (tournamentId) => request(`/tournaments/${tournamentId}/`),

  // TEAMS BELONG TO TOURNAMENTS

  teams: (tournamentId) => request(`/tournaments/${tournamentId}/teams/`),

  team: (teamId) => request(`/teams/${teamId}/`),

  // SEASONS BELONG TO TOURNAMENTS

 seasons: (tournamentId) =>
  request(`/tournaments/${tournamentId}/seasons/`).then(newestFirst),

  createSeason: (tournamentId, body = {}) =>
    request(`/tournaments/${tournamentId}/seasons/`, {
      method: "POST",
      body,
    }),

  // SEASON-BASED OPERATIONS

  standings: (seasonId) => request(`/seasons/${seasonId}/standings/`),

  fixtures: (seasonId) => request(`/seasons/${seasonId}/fixtures/`),

  generateFixtures: (seasonId, doubleRound) =>
    request(`/seasons/${seasonId}/generate-fixtures/`, {
      method: "POST",
      body: {
        double_round: doubleRound,
      },
    }),

  scrapSeason: (seasonId, force = false) =>
    request(`/seasons/${seasonId}/${force ? "?force=true" : ""}`, {
      method: "DELETE",
    }),

  endSeason: (seasonId) =>
    request(`/seasons/${seasonId}/end/`, {
      method: "POST",
    }),

  // AUTHENTICATION

  login: (username, password) =>
    request("/auth/login/", {
      method: "POST",
      body: { username, password },
    }),

  logout: () =>
    request("/auth/logout/", {
      method: "POST",
    }),

  // TOURNAMENT MANAGEMENT

  createTournament: (name) =>
    request("/tournaments/", {
      method: "POST",
      body: { name },
    }),

  updateTournament: (tournamentId, body) =>
    request(`/tournaments/${tournamentId}/`, {
      method: "PATCH",
      body,
    }),

  deleteTournament: (tournamentId) =>
    request(`/tournaments/${tournamentId}/`, {
      method: "DELETE",
    }),

  // TEAM MANAGEMENT

  createTeam: (tournamentId, formData) =>
    request(`/tournaments/${tournamentId}/teams/`, {
      method: "POST",
      body: formData,
    }),

  updateTeam: (teamId, formData) =>
    request(`/teams/${teamId}/`, {
      method: "PATCH",
      body: formData,
    }),

  deleteTeam: (teamId) =>
    request(`/teams/${teamId}/`, {
      method: "DELETE",
    }),

  setTeamActive: (teamId, isActive) =>
    request(`/teams/${teamId}/`, {
      method: "PATCH",
      body: { is_active: isActive },
    }),

  // MATCH MANAGEMENT

  setScore: (matchId, homeGoals, awayGoals) =>
    request(`/matches/${matchId}/`, {
      method: "PATCH",
      body: {
        home_goals: homeGoals,
        away_goals: awayGoals,
      },
    }),

  // KNOCKOUT (one per season)
  knockout: (seasonId) => request(`/seasons/${seasonId}/knockout/`),
  createKnockout: (seasonId, body) =>
    request(`/seasons/${seasonId}/knockout/`, { method: "POST", body }),
  resetKnockout: (seasonId) =>
    request(`/seasons/${seasonId}/knockout/`, { method: "DELETE" }),
  setKnockoutScore: (matchId, body) =>
    request(`/knockout/matches/${matchId}/score/`, { method: "PATCH", body }),
};

// ----------------------------------
// REUSABLE API HOOK
// ----------------------------------

export function useApi(fn, deps = []) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
  });

  const [tick, setTick] = useState(0);

  const silent = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (!silent.current) {
      setState({
        data: null,
        loading: true,
        error: null,
      });
    }

    silent.current = false;

    fn()
      .then((data) => {
        if (!cancelled) {
          setState({
            data,
            loading: false,
            error: null,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error,
          });
        }
      });

    return () => {
      cancelled = true;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => {
    silent.current = true;
    setTick((current) => current + 1);
  }, []);

  return {
    ...state,
    reload,
  };
}
