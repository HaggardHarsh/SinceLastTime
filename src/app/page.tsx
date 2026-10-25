export default function Home() {
  return <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-6 p-8">
    <span className="text-sm font-semibold uppercase tracking-[.3em] text-violet-300">SinceLastTime</span>
    <h1 className="max-w-2xl text-5xl font-semibold leading-tight">Every username has a story.<br />Pick up where you left off.</h1>
    <p className="max-w-xl text-lg leading-relaxed text-zinc-400">A place for your Twitch community to share life’s little updates — and make time for each other.</p>
    <a href="/api/auth/twitch" className="w-fit rounded-xl bg-violet-300 px-6 py-3 font-semibold text-zinc-950">Connect with Twitch</a>
  </main>;
}
