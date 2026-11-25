import type {
  AdoptPreviewInput,
  AdoptPreviewOutput,
  CreateEndpointInput,
  CreateEndpointOutput,
  GeneratePreviewInput,
  LlmConfigView,
  PreviewJobView,
  RetryInput,
  RouteIdInput,
  RouteView,
  SaveBackgroundInput,
  SaveBackgroundOutput,
  SetPurposeInput,
  SubmitActionInput,
  TestConnectionInput,
  TestConnectionResult,
  TurnRequestView,
  UpdateEndpointInput,
  WorkDetail,
  WorkIdInput,
  WorkSummary,
} from "@unwritten/contracts";
import type { EventBus } from "./events/bus.ts";
import type { LlmRunInput, LlmRunResult, Purpose, ResolvedModel } from "./llm/types.ts";
import type { Logger } from "./log/logger.ts";
import type { Database } from "./store/db.ts";

export interface LlmService {
  listProviders(): LlmConfigView;
  createEndpoint(input: CreateEndpointInput): Promise<CreateEndpointOutput>;
  updateEndpoint(input: UpdateEndpointInput): Promise<LlmConfigView>;
  setPurpose(input: SetPurposeInput): Promise<LlmConfigView>;
  testConnection(input: TestConnectionInput): Promise<TestConnectionResult>;
  resolve(purpose: Purpose): ResolvedModel | null;
  estimateTokens(text: string): number;
  run(input: LlmRunInput): Promise<LlmRunResult>;
  pruneCalls(): number;
}

export interface LibraryService {
  list(): WorkSummary[];
  create(input: WorkIdInput): WorkDetail;
  get(input: WorkIdInput): WorkDetail;
  saveBackground(input: SaveBackgroundInput): SaveBackgroundOutput;
}

export interface AuthoringService {
  generatePreview(input: GeneratePreviewInput): PreviewJobView;
  adoptPreview(input: AdoptPreviewInput): AdoptPreviewOutput;
  recoverInterrupted(): number;
  whenIdle(): Promise<void>;
}

export interface PlayService {
  getRoute(input: RouteIdInput): RouteView;
  submitAction(input: SubmitActionInput): TurnRequestView;
  retry(input: RetryInput): TurnRequestView;
  recoverInterrupted(): number;
  pruneOldRequestLogs(): number;
  whenIdle(): Promise<void>;
}

export interface CoreDeps {
  shutdown: AbortSignal;
  dataDir: string;
  db: Database;
  bus: EventBus;
  logger: Logger;
}

export interface Services {
  llm: LlmService;
  library: LibraryService;
  authoring: AuthoringService;
  play: PlayService;
  bus: EventBus;
  logger: Logger;
}

export interface ServiceFactories {
  llm(deps: CoreDeps): LlmService;
  library(deps: CoreDeps): LibraryService;
  authoring(deps: CoreDeps & { llm: LlmService }): AuthoringService;
  play(deps: CoreDeps & { llm: LlmService }): PlayService;
}
