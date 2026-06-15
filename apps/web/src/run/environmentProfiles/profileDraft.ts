import type { EnvironmentProfile } from "@greenlight/contracts";

export interface EnvironmentProfileDraft {
  readonly name: string;
  readonly targetUrl: string;
  readonly notes: string;
  readonly authRef: string;
}

export const draftFromProfile = (profile: EnvironmentProfile): EnvironmentProfileDraft => ({
  name: profile.name,
  targetUrl: profile.targetUrl,
  notes: profile.notes ?? "",
  authRef: profile.authRef ?? "",
});

export const blankDraft = (targetUrl: string): EnvironmentProfileDraft => ({
  name: "",
  targetUrl,
  notes: "",
  authRef: "",
});
