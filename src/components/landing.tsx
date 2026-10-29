"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useFeedback, useSession } from "./providers";
import { Avatar, Brand } from "./ui";

export function Landing() {
  const { data } = useSession();
  const { demo } = useFeedback();
  const { run, pending } = useAction();
  const destination = data?.user ? "/communities" : "/api/auth/twitch";
  const primaryLabel = data?.user ? "Back to your people" : "Connect with Twitch";

  return (
    <div className="landing ledger-page">
      <nav className="ledger-nav" aria-label="Main navigation">
        <Brand />
        <span className="ledger-edition">
          A COMMUNITY LEDGER <span>·</span> NO. 01
        </span>
        <div className="ledger-nav-links">
          <a href="#how-it-works">How it works</a>
          <Link href="/about">About this space</Link>
        </div>
        <a className="button button-primary ledger-nav-action" href={destination}>
          {primaryLabel} <ArrowUpRight size={15} />
        </a>
      </nav>

      <main>
        <section className="ledger-opening">
          <div className="ledger-intro">
            <p className="ledger-kicker">
              <span /> FOR THE PEOPLE BEHIND THE USERNAMES
            </p>
            <h1>
              The story is
              <br />
              still <em>going.</em>
            </h1>
            <p className="ledger-deck">
              A place for your Twitch community to share life between streams—and remember to ask
              what happened next.
            </p>
            <div className="ledger-actions">
              <a className="button button-primary" href={destination}>
                {data?.user ? "Back to your people" : "Find your community"}
                <ArrowUpRight size={16} />
              </a>
              {demo ? (
                <button
                  className="ledger-demo-link"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      await api("auth/demo", { method: "POST", body: { login: "maya" } });
                      window.location.assign("/c/luna");
                    })
                  }
                >
                  Read the local demo <ArrowUpRight size={14} />
                </button>
              ) : (
                <a className="ledger-demo-link" href="#how-it-works">
                  See how it works <ArrowDownRight size={14} />
                </a>
              )}
            </div>
            <p className="ledger-footnote">For the little things that make a life.</p>
          </div>

          <article className="ledger-feature" aria-label="Maya's story, then and now">
            <header className="ledger-feature-head">
              <span>THE CONVERSATION, CONTINUED</span>
              <span>
                01 <i>/</i> 03
              </span>
            </header>
            <div className="ledger-chapter ledger-chapter-before">
              <div className="ledger-chapter-meta">
                <span>
                  THEN <i>·</i> LAST STREAM
                </span>
                <span>
                  <Avatar name="Maya" size="xs" /> MAYA
                </span>
              </div>
              <p>
                First job interview tomorrow. Wish me luck! <span>🤞</span>
              </p>
              <small>12 people were rooting for her</small>
            </div>
            <div className="ledger-turn" aria-hidden="true">
              <span /> THEN, A WEEK LATER <ArrowDownRight size={16} />
            </div>
            <div className="ledger-chapter ledger-chapter-after">
              <div className="ledger-chapter-meta">
                <span>
                  NOW <i>·</i> SINCE LAST TIME
                </span>
                <span>
                  <Avatar name="Maya" size="xs" /> MAYA
                </span>
              </div>
              <p>
                I got the job! Starting Monday. <span>🥹</span>
              </p>
              <div className="ledger-reply">
                <Avatar name="Luna" size="xs" />
                <p>
                  <strong>Luna</strong> Maya!! We knew you could do it.
                </p>
              </div>
            </div>
            <footer className="ledger-feature-foot">
              A little update becomes a story worth remembering.
            </footer>
          </article>
        </section>

        <div className="ledger-index" aria-label="What this space makes possible">
          <span>SMALL UPDATES</span>
          <i>—</i>
          <span>GOOD CONVERSATIONS</span>
          <i>—</i>
          <span>THE NEXT CHAPTER</span>
        </div>

        <section className="ledger-how" id="how-it-works">
          <header className="ledger-section-head">
            <span className="ledger-section-number">01 / THE RITUAL</span>
            <h2>
              A thread worth
              <br />
              picking back up.
            </h2>
            <p>Three small moments make room for a more thoughtful kind of catch-up.</p>
          </header>
          <ol className="ledger-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Leave a note.</h3>
                <p>
                  A small win, a work in progress, a bit of life your community will be glad to
                  hear.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Make a little time.</h3>
                <p>
                  The streamer brings a fair mix of updates to stream, so different people get their
                  moment.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Ask what happened.</h3>
                <p>
                  Follow up with the people and the stories you remember. That’s where the next
                  chapter starts.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section className="ledger-studio">
          <div className="ledger-rundown" aria-label="Example stream lineup">
            <header>
              <span>FROM THE STUDIO DESK</span>
              <span>
                TONIGHT <i>·</i> 5 UPDATES
              </span>
            </header>
            <div className="ledger-rundown-row">
              <span className="ledger-row-no">01</span>
              <Avatar name="Nina" size="sm" />
              <div>
                <strong>Nina</strong>
                <small>Hasn’t been featured yet</small>
              </div>
              <Check size={15} />
            </div>
            <div className="ledger-rundown-row">
              <span className="ledger-row-no">02</span>
              <Avatar name="Olive" size="sm" />
              <div>
                <strong>Olive</strong>
                <small>Community pick</small>
              </div>
              <Check size={15} />
            </div>
            <div className="ledger-rundown-row ledger-rundown-featured">
              <span className="ledger-row-no">03</span>
              <Avatar name="Maya" size="sm" />
              <div>
                <strong>Maya</strong>
                <small>A new chapter</small>
              </div>
              <Check size={15} />
            </div>
            <p>One good conversation at a time.</p>
          </div>
          <div className="ledger-studio-copy">
            <span className="ledger-section-number">02 / FOR THE PERSON BEHIND THE STREAM</span>
            <h2>
              Give the good stuff
              <br />
              room to breathe.
            </h2>
            <p>
              A ready-to-review lineup and a simple OBS overlay help turn a passing chat message
              into a conversation your community can share.
            </p>
            <a className="ledger-inline-link" href={destination}>
              Make room for your community <ArrowUpRight size={15} />
            </a>
          </div>
        </section>

        <section className="ledger-promise">
          <span className="ledger-section-number">A NOTE ON PRIVACY</span>
          <p>
            Every community has its own board. Sharing an update on stream is always a separate
            choice.
          </p>
          <Link href="/about" className="ledger-inline-link">
            How your updates work <ArrowUpRight size={15} />
          </Link>
        </section>

        <section className="ledger-close">
          <p>There’s always a little more to the story.</p>
          <h2>
            Pick it up
            <br />
            <em>next time.</em>
          </h2>
          <a className="button button-primary" href={destination}>
            {primaryLabel} <ArrowUpRight size={16} />
          </a>
        </section>
      </main>

      <footer className="ledger-footer">
        <Brand />
        <span>Stories shared among people who care.</span>
        <div>
          <Link href="/about">About & your updates</Link>
          <a href="https://github.com/HaggardHarsh/SinceLastTime" target="_blank" rel="noreferrer">
            Project notes <ArrowUpRight size={12} />
          </a>
        </div>
      </footer>
    </div>
  );
}
