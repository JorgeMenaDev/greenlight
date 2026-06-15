/**
 * WebSocket RPC contract surface shared by the server and all clients.
 *
 * Every method is declared once here with `Rpc.make` and composed into
 * `WsRpcGroup`; the server implements the group via `WsRpcGroup.toLayer`
 * and clients consume it via `RpcClient.make(WsRpcGroup)`.
 *
 * @module rpc
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { BasicAuthCredentials } from "./auth.ts";
import { BrowserStatus } from "./browser.ts";
import { CopilotAuthStatus, CopilotModel, CopilotUnavailableError } from "./copilot.ts";
import {
  EnvironmentProfile,
  EnvironmentProfileError,
  EnvironmentProfileInput,
  LocalAuthCredentialStatus,
} from "./environmentProfiles.ts";
import { RunEvent } from "./events.ts";
import { FeatureFileEntry, GherkinParseError, ParsedFeature } from "./feature.ts";
import { EnvironmentProfileId, PickleId, RunId } from "./ids.ts";
import {
  FeatureIoError,
  NoProjectOpenError,
  ProjectError,
  ProjectInfo,
  RecentProject,
} from "./project.ts";
import { Run, RunSummary } from "./run.ts";
import { ServerInfo } from "./server.ts";
import { RunTarget } from "./targets.ts";

export class RunNotFoundError extends Schema.TaggedErrorClass<RunNotFoundError>()(
  "RunNotFoundError",
  { runId: RunId },
) {
  override get message(): string {
    return `Run not found: ${this.runId}`;
  }
}

export class RunAlreadyActiveError extends Schema.TaggedErrorClass<RunAlreadyActiveError>()(
  "RunAlreadyActiveError",
  { activeRunId: RunId },
) {
  override get message(): string {
    return `A run is already in progress (${this.activeRunId}).`;
  }
}

export class RunStartError extends Schema.TaggedErrorClass<RunStartError>()("RunStartError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

export const WS_METHODS = {
  // Project
  projectOpen: "project.open",
  projectCurrent: "project.current",
  projectRecent: "project.recent",

  // Environment profiles
  environmentProfilesList: "environmentProfiles.list",
  environmentProfilesSave: "environmentProfiles.save",
  environmentProfilesDelete: "environmentProfiles.delete",
  environmentProfileCredentialsList: "environmentProfileCredentials.list",
  environmentProfileCredentialsSave: "environmentProfileCredentials.save",
  environmentProfileCredentialsDelete: "environmentProfileCredentials.delete",

  // Feature files
  featuresList: "features.list",
  featuresRead: "features.read",
  featuresWrite: "features.write",
  featuresCreate: "features.create",
  featuresDelete: "features.delete",

  // Runs
  runStart: "run.start",
  runCancel: "run.cancel",
  runSubscribe: "run.subscribe",
  runsList: "runs.list",
  runsGet: "runs.get",
  runsDelete: "runs.delete",

  // Copilot
  copilotAuthStatus: "copilot.authStatus",
  copilotListModels: "copilot.listModels",

  // Browser
  browserStatus: "browser.status",

  // Server meta
  serverGetConfig: "server.getConfig",
} as const;

const FeatureParse = Schema.Struct({
  feature: Schema.NullOr(ParsedFeature),
  errors: Schema.Array(GherkinParseError),
});

export const WsProjectOpenRpc = Rpc.make(WS_METHODS.projectOpen, {
  payload: Schema.Struct({ path: Schema.String }),
  success: ProjectInfo,
  error: ProjectError,
});

export const WsProjectCurrentRpc = Rpc.make(WS_METHODS.projectCurrent, {
  payload: Schema.Struct({}),
  success: Schema.NullOr(ProjectInfo),
});

export const WsProjectRecentRpc = Rpc.make(WS_METHODS.projectRecent, {
  payload: Schema.Struct({}),
  success: Schema.Array(RecentProject),
});

export const WsEnvironmentProfilesListRpc = Rpc.make(WS_METHODS.environmentProfilesList, {
  payload: Schema.Struct({}),
  success: Schema.Array(EnvironmentProfile),
  error: Schema.Union([NoProjectOpenError, EnvironmentProfileError]),
});

export const WsEnvironmentProfilesSaveRpc = Rpc.make(WS_METHODS.environmentProfilesSave, {
  payload: EnvironmentProfileInput,
  success: EnvironmentProfile,
  error: Schema.Union([NoProjectOpenError, EnvironmentProfileError]),
});

export const WsEnvironmentProfilesDeleteRpc = Rpc.make(WS_METHODS.environmentProfilesDelete, {
  payload: Schema.Struct({
    id: EnvironmentProfileId,
    deleteLocalCredentials: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({}),
  error: Schema.Union([NoProjectOpenError, EnvironmentProfileError]),
});

export const WsEnvironmentProfileCredentialsListRpc = Rpc.make(
  WS_METHODS.environmentProfileCredentialsList,
  {
    payload: Schema.Struct({}),
    success: Schema.Array(LocalAuthCredentialStatus),
    error: NoProjectOpenError,
  },
);

export const WsEnvironmentProfileCredentialsSaveRpc = Rpc.make(
  WS_METHODS.environmentProfileCredentialsSave,
  {
    payload: Schema.Struct({
      authRef: Schema.String,
      credentials: BasicAuthCredentials,
    }),
    success: Schema.Struct({}),
    error: Schema.Union([NoProjectOpenError, EnvironmentProfileError]),
  },
);

export const WsEnvironmentProfileCredentialsDeleteRpc = Rpc.make(
  WS_METHODS.environmentProfileCredentialsDelete,
  {
    payload: Schema.Struct({ authRef: Schema.String }),
    success: Schema.Struct({}),
    error: Schema.Union([NoProjectOpenError, EnvironmentProfileError]),
  },
);

export const WsFeaturesListRpc = Rpc.make(WS_METHODS.featuresList, {
  payload: Schema.Struct({}),
  success: Schema.Array(FeatureFileEntry),
  error: Schema.Union([NoProjectOpenError, ProjectError]),
});

export const WsFeaturesReadRpc = Rpc.make(WS_METHODS.featuresRead, {
  payload: Schema.Struct({ path: Schema.String }),
  success: Schema.Struct({ content: Schema.String, parsed: FeatureParse }),
  error: Schema.Union([NoProjectOpenError, FeatureIoError]),
});

export const WsFeaturesWriteRpc = Rpc.make(WS_METHODS.featuresWrite, {
  payload: Schema.Struct({ path: Schema.String, content: Schema.String }),
  success: Schema.Struct({ parsed: FeatureParse }),
  error: Schema.Union([NoProjectOpenError, FeatureIoError]),
});

export const WsFeaturesCreateRpc = Rpc.make(WS_METHODS.featuresCreate, {
  payload: Schema.Struct({ name: Schema.String }),
  success: FeatureFileEntry,
  error: Schema.Union([NoProjectOpenError, FeatureIoError]),
});

export const WsFeaturesDeleteRpc = Rpc.make(WS_METHODS.featuresDelete, {
  payload: Schema.Struct({ path: Schema.String }),
  success: Schema.Struct({}),
  error: Schema.Union([NoProjectOpenError, FeatureIoError]),
});

export const WsRunStartRpc = Rpc.make(WS_METHODS.runStart, {
  payload: Schema.Struct({
    featurePath: Schema.String,
    target: RunTarget,
    pickleIds: Schema.optional(Schema.Array(PickleId)),
    model: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ runId: RunId }),
  error: Schema.Union([NoProjectOpenError, FeatureIoError, RunAlreadyActiveError, RunStartError]),
});

export const WsRunCancelRpc = Rpc.make(WS_METHODS.runCancel, {
  payload: Schema.Struct({ runId: RunId }),
  success: Schema.Struct({}),
  error: RunNotFoundError,
});

export const WsRunSubscribeRpc = Rpc.make(WS_METHODS.runSubscribe, {
  payload: Schema.Struct({
    runId: RunId,
    afterSeq: Schema.optional(Schema.Number),
  }),
  success: RunEvent,
  error: RunNotFoundError,
  stream: true,
});

export const WsRunsListRpc = Rpc.make(WS_METHODS.runsList, {
  payload: Schema.Struct({
    featurePath: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
    offset: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(RunSummary),
});

export const WsRunsGetRpc = Rpc.make(WS_METHODS.runsGet, {
  payload: Schema.Struct({ runId: RunId }),
  success: Run,
  error: RunNotFoundError,
});

export const WsRunsDeleteRpc = Rpc.make(WS_METHODS.runsDelete, {
  payload: Schema.Struct({ runId: RunId }),
  success: Schema.Struct({}),
  error: RunNotFoundError,
});

export const WsCopilotAuthStatusRpc = Rpc.make(WS_METHODS.copilotAuthStatus, {
  payload: Schema.Struct({}),
  success: CopilotAuthStatus,
});

export const WsCopilotListModelsRpc = Rpc.make(WS_METHODS.copilotListModels, {
  payload: Schema.Struct({}),
  success: Schema.Array(CopilotModel),
  error: CopilotUnavailableError,
});

export const WsBrowserStatusRpc = Rpc.make(WS_METHODS.browserStatus, {
  payload: Schema.Struct({}),
  success: BrowserStatus,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerInfo,
});

export const WsRpcGroup = RpcGroup.make(
  WsProjectOpenRpc,
  WsProjectCurrentRpc,
  WsProjectRecentRpc,
  WsEnvironmentProfilesListRpc,
  WsEnvironmentProfilesSaveRpc,
  WsEnvironmentProfilesDeleteRpc,
  WsEnvironmentProfileCredentialsListRpc,
  WsEnvironmentProfileCredentialsSaveRpc,
  WsEnvironmentProfileCredentialsDeleteRpc,
  WsFeaturesListRpc,
  WsFeaturesReadRpc,
  WsFeaturesWriteRpc,
  WsFeaturesCreateRpc,
  WsFeaturesDeleteRpc,
  WsRunStartRpc,
  WsRunCancelRpc,
  WsRunSubscribeRpc,
  WsRunsListRpc,
  WsRunsGetRpc,
  WsRunsDeleteRpc,
  WsCopilotAuthStatusRpc,
  WsCopilotListModelsRpc,
  WsBrowserStatusRpc,
  WsServerGetConfigRpc,
);
