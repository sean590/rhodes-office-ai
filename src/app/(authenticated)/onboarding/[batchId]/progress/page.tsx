import { redirect } from "next/navigation";

// The standalone onboarding progress page is folded into the onboarding stepper
// (UX refresh Phase 8) and the unified Processing surface. Land on Home, where
// the freshly-onboarded work surfaces (Processing strip + Needs-you lanes).
export default function OnboardingProgressRedirect() {
  redirect("/home");
}
