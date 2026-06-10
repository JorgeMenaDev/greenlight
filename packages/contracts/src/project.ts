/**
 * Project contracts - a project is a folder of .feature files.
 *
 * @module project
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./ids.ts";

export const ProjectInfo = Schema.Struct({
  path: TrimmedNonEmptyString,
  featureCount: Schema.Number,
});
export type ProjectInfo = typeof ProjectInfo.Type;

export const RecentProject = Schema.Struct({
  path: TrimmedNonEmptyString,
  lastOpenedAt: IsoDateTime,
});
export type RecentProject = typeof RecentProject.Type;

export class ProjectError extends Schema.TaggedErrorClass<ProjectError>()("ProjectError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export class NoProjectOpenError extends Schema.TaggedErrorClass<NoProjectOpenError>()(
  "NoProjectOpenError",
  {},
) {
  override get message(): string {
    return "No project folder is open.";
  }
}

export class FeatureIoError extends Schema.TaggedErrorClass<FeatureIoError>()("FeatureIoError", {
  path: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `${this.path}: ${this.detail}`;
  }
}
