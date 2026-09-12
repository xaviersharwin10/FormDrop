import { Suspense } from "react";
import { ClaimClient } from "./ClaimClient";

export default function ClaimPage() {
  return (
    <Suspense fallback={<div className="claim-shell" />}>
      <ClaimClient />
    </Suspense>
  );
}
