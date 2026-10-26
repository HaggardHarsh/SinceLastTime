"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Sparkles } from "lucide-react";
import { api, ClientError } from "@/lib/api";
import type { PublicUser } from "@/shared/types";
import { usePathname } from "next/navigation";

const Feedback = createContext<{ notify: (text: string, error?: boolean) => void; demo: boolean }>({
  notify: () => {},
  demo: false,
});
export const useFeedback = () => useContext(Feedback);
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api<{ user: PublicUser & { isDemo: boolean }; demoMode: boolean }>("me");
      } catch (error) {
        if (error instanceof ClientError && error.status === 401)
          return { user: null, demoMode: false };
        throw error;
      }
    },
    refetchInterval: 60_000,
  });
}
export function useAction() {
  const [pending, setPending] = useState(false);
  const { notify } = useFeedback();
  const queryClient = useQueryClient();
  const run = async <T,>(action: () => Promise<T>, message?: string): Promise<T | undefined> => {
    if (pending) return;
    setPending(true);
    try {
      const result = await action();
      await queryClient.invalidateQueries();
      if (message) notify(message);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Please try again.", true);
      return undefined;
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}

function DemoBar() {
  const session = useSession();
  const user = session.data?.user;
  const identities = [
    ["maya", "Maya · viewer"],
    ["luna", "Luna · streamer"],
    ["rohan", "Rohan · moderator"],
    ["olive", "Olive · viewer"],
    ["visitor", "Non-follower"],
  ];
  const login = user?.isDemo && identities.some(([id]) => id === user.login) ? user.login : "";
  const { pending, run } = useAction();
  return (
    <div className="demo-bar">
      <Sparkles size={13} />
      <span>Local demo</span>
      <span className="demo-hint">Explore the community as</span>
      <select
        aria-label="Demo identity"
        value={login}
        disabled={pending || session.isPending}
        onChange={(event) => {
          const nextLogin = event.target.value;
          if (!nextLogin || nextLogin === login) return;
          void run(async () => {
            await api("auth/demo", { method: "POST", body: { login: nextLogin } });
            window.location.assign("/c/luna");
          });
        }}
      >
        <option value="" disabled>
          {session.isPending
            ? "Loading…"
            : user
              ? `${user.displayName} · current account`
              : "Choose a perspective…"}
        </option>
        {identities.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <span role="status">{pending ? "Switching…" : "Switch perspective anytime"}</span>
    </div>
  );
}

export function Providers({ children, demo }: { children: React.ReactNode; demo: boolean }) {
  const pathname = usePathname();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 0,
            refetchOnWindowFocus: "always",
            refetchIntervalInBackground: false,
          },
        },
      }),
  );
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast((old) => (old?.text === text ? null : old)), 6000);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <Feedback.Provider value={{ notify, demo }}>
        {demo && !pathname.startsWith("/overlay/") && <DemoBar />}
        {children}
        {toast && (
          <div
            role={toast.error ? "alert" : "status"}
            className={`toast ${toast.error ? "toast-error" : ""}`}
          >
            {toast.error ? <X size={18} /> : <Check size={18} />}
            <span>{toast.text}</span>
            <button onClick={() => setToast(null)} aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </div>
        )}
      </Feedback.Provider>
    </QueryClientProvider>
  );
}
