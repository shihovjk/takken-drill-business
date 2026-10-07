import { useEffect, useRef } from "react";
import { computeMetrics } from "@core/metrics.ts";
import type { Backend } from "../../lib/types";

// The full study app from takken-drill.com (public/study/), full screen on phones and PCs.
// It reports every answer here, and its 「支給」 tab asks this page for the award, the company's rules,
// the employee's own study over the evaluation window, and the PayPal status.
export default function Study({ backend, userId, onSignOut }: { backend: Backend; userId: string; onSignOut: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const reply = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, location.origin);
    const awardView = async () => {
      const [{ award, judgement, payee, messages, attempts }, rules] = await Promise.all([backend.me(), backend.rules()]);
      const m = computeMetrics(attempts);
      const progress = { minutes: m.minutes, studyDays: m.studyDays, n: m.n, accuracy: m.accuracy, medianSec: m.medianSec, weeks: m.weeks.map((w) => w.minutes) };
      return { award, judgement, payee, messages, rules, progress };
    };
    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      switch (e.data?.type) {
        case "tdb-attempt":
          backend.recordAttempt(e.data.attempt).catch((err) => console.warn("could not record answer", err));
          break;
        case "tdb-get-award":
          reply({ type: "tdb-award", me: await awardView() });
          break;
        case "tdb-connect-paypal":
          await backend.connectPayPal();
          reply({ type: "tdb-award", me: await awardView() });
          break;
        case "tdb-signout":
          onSignOut();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [backend, onSignOut]);
  return <iframe ref={frame} className="study-frame" title="宅建過去問ドリル" src={`/study/index.html?u=${encodeURIComponent(userId)}`} />;
}
