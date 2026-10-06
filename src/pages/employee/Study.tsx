import { useEffect, useRef } from "react";
import type { Backend } from "../../lib/types";

// The full study app from takken-drill.com (public/study/), full screen on phones and PCs.
// It reports every answer here, and its 「支給」 tab asks this page for the award and PayPal status.
export default function Study({ backend, userId, onSignOut }: { backend: Backend; userId: string; onSignOut: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const reply = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, location.origin);
    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      switch (e.data?.type) {
        case "tdb-attempt":
          backend.recordAttempt(e.data.attempt).catch((err) => console.warn("could not record answer", err));
          break;
        case "tdb-get-award": {
          const { award, judgement, payee, messages } = await backend.me();
          reply({ type: "tdb-award", me: { award, judgement, payee, messages } });
          break;
        }
        case "tdb-connect-paypal":
          await backend.connectPayPal();
          reply({ type: "tdb-award", me: await backend.me().then(({ award, judgement, payee, messages }) => ({ award, judgement, payee, messages })) });
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
