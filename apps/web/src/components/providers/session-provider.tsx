"use client";

import type {
  AppSession,
  SessionOrganizationSummary,
  SessionSpaceSummary,
  UpdateUserPreferencesRequest,
} from "@project-delivery/shared";
import { useLocale } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createOrganizationAndRefreshSession,
  getPersistedAppSession,
  loginAccount,
  logoutAccount,
  refreshAppSession,
  registerAccount,
  switchSpace,
  switchOrganization,
  updateUserPreferences,
} from "../../lib/session-service";
import {
  mergePreferences,
  toNextThemeMode,
  type NextThemeMode,
} from "../../lib/preferences";
import { isUnauthorizedApiError } from "../../lib/api-error-messages";
import { usePathname, useRouter } from "../../i18n/routing";
import type {
  CreateOrganizationFormValues,
  LoginFormValues,
  RegisterFormValues,
} from "../../lib/auth-forms";
import { useTheme } from "./theme-provider";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

type SessionContextValue = {
  currentOrganization: SessionOrganizationSummary | undefined;
  currentSpace: SessionSpaceSummary | undefined;
  createOrganization: (
    input: CreateOrganizationFormValues,
  ) => Promise<AppSession>;
  initializeSession: () => Promise<void>;
  login: (input: LoginFormValues) => Promise<AppSession>;
  logout: () => Promise<void>;
  persistPreferences: (
    patch: Partial<UpdateUserPreferencesRequest>,
  ) => Promise<void>;
  refreshSession: (
    recentOrganizationId?: string,
    recentSpaceId?: string,
  ) => Promise<AppSession>;
  register: (input: RegisterFormValues) => Promise<AppSession>;
  session: AppSession | null;
  spacesForCurrentOrganization: SessionSpaceSummary[];
  status: SessionStatus;
  switchOrganization: (organizationId: string) => Promise<AppSession>;
  switchSpace: (spaceId: string) => Promise<AppSession>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

type SessionProviderProps = {
  children: ReactNode;
};

export function SessionProvider({ children }: SessionProviderProps) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  const initializeSession = useCallback(async () => {
    setStatus("loading");

    try {
      const nextSession = await getPersistedAppSession();
      setSession(nextSession);
      setStatus("authenticated");
    } catch (error) {
      if (!isUnauthorizedApiError(error)) {
        throw error;
      }

      setSession(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    void initializeSession();
  }, [initializeSession]);

  const refreshSession = useCallback(
    async (recentOrganizationId?: string, recentSpaceId?: string) => {
      const nextSession = await refreshAppSession(
        recentOrganizationId,
        recentSpaceId,
      );
      setSession(nextSession);
      setStatus("authenticated");

      return nextSession;
    },
    [],
  );

  const register = useCallback(async (input: RegisterFormValues) => {
    const nextSession = await registerAccount(input);
    setSession(nextSession);
    setStatus("authenticated");

    return nextSession;
  }, []);

  const login = useCallback(async (input: LoginFormValues) => {
    const nextSession = await loginAccount(input);
    setSession(nextSession);
    setStatus("authenticated");

    return nextSession;
  }, []);

  const createOrganization = useCallback(
    async (input: CreateOrganizationFormValues) => {
      const nextSession = await createOrganizationAndRefreshSession(input);
      setSession(nextSession);
      setStatus("authenticated");

      return nextSession;
    },
    [],
  );

  const chooseOrganization = useCallback(async (organizationId: string) => {
    const nextSession = await switchOrganization(organizationId);
    setSession(nextSession);
    setStatus("authenticated");

    return nextSession;
  }, []);

  const chooseSpace = useCallback(
    async (spaceId: string) => {
      const organizationId =
        session?.spaces.find((space) => space.id === spaceId)?.organizationId ??
        session?.defaultOrganizationId;

      if (!organizationId) {
        throw new Error("Cannot switch space without an organization context");
      }

      const nextSession = await switchSpace(organizationId, spaceId);
      setSession(nextSession);
      setStatus("authenticated");

      return nextSession;
    },
    [session],
  );

  const persistPreferences = useCallback(
    async (patch: Partial<UpdateUserPreferencesRequest>) => {
      if (!session) {
        return;
      }

      const preferences = await updateUserPreferences(
        mergePreferences(session.user.preferences, patch),
      );

      setSession((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          user: {
            ...current.user,
            preferences,
          },
        };
      });
    },
    [session],
  );

  const logout = useCallback(async () => {
    try {
      await logoutAccount();
    } finally {
      setSession(null);
      setStatus("unauthenticated");
    }
  }, []);

  const currentOrganization = useMemo(() => {
    if (!session?.defaultOrganizationId) {
      return undefined;
    }

    return session.organizations.find(
      (organization) => organization.id === session.defaultOrganizationId,
    );
  }, [session]);

  const spacesForCurrentOrganization = useMemo(() => {
    if (!session?.defaultOrganizationId) {
      return [];
    }

    return session.spaces.filter(
      (space) => space.organizationId === session.defaultOrganizationId,
    );
  }, [session]);

  const currentSpace = useMemo(() => {
    if (!session?.defaultSpaceId) {
      return undefined;
    }

    return spacesForCurrentOrganization.find(
      (space) => space.id === session.defaultSpaceId,
    );
  }, [session, spacesForCurrentOrganization]);

  const value = useMemo<SessionContextValue>(
    () => ({
      currentOrganization,
      currentSpace,
      createOrganization,
      initializeSession,
      login,
      logout,
      persistPreferences,
      refreshSession,
      register,
      session,
      spacesForCurrentOrganization,
      status,
      switchOrganization: chooseOrganization,
      switchSpace: chooseSpace,
    }),
    [
      chooseOrganization,
      chooseSpace,
      createOrganization,
      currentOrganization,
      currentSpace,
      initializeSession,
      login,
      logout,
      persistPreferences,
      refreshSession,
      register,
      session,
      spacesForCurrentOrganization,
      status,
    ],
  );

  return (
    <SessionContext.Provider value={value}>
      <SessionPreferenceSync session={session} />
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession must be used within SessionProvider");
  }

  return value;
}

type SessionPreferenceSyncProps = {
  session: AppSession | null;
};

function SessionPreferenceSync({ session }: SessionPreferenceSyncProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useTheme();
  const appliedThemeRef = useRef<NextThemeMode | null>(null);
  const appliedLocaleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    const nextTheme = toNextThemeMode(session.user.preferences.themeMode);

    if (appliedThemeRef.current !== nextTheme) {
      appliedThemeRef.current = nextTheme;
      setTheme(nextTheme);
    }
  }, [session, setTheme]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const nextLocale = session.user.preferences.locale;

    if (nextLocale !== locale && appliedLocaleRef.current !== nextLocale) {
      appliedLocaleRef.current = nextLocale;
      router.replace(pathname, { locale: nextLocale });
    }
  }, [locale, pathname, router, session]);

  return null;
}
