import { Suspense } from "react";
import { ClaimClient } from "./ClaimClient";

export default function ClaimPage() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <ClaimClient />
    </Suspense>
  );
}
