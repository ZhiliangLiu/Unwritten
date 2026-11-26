import type {
  AddModelInput,
  AdoptPreviewInput,
  AdoptPreviewOutput,
  Appearance,
  CreateEndpointInput,
  CreateEndpointOutput,
  GeneratePreviewInput,
  JournalView,
  LlmConfigView,
  PreviewJobView,
  RemoveEndpointInput,
  RemoveModelInput,
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
  UpdateModelInput,
  WorkDetail,
  WorkIdInput,
  WorkSummary,
} from '@unwritten/contracts';
import type { EventBus } from './events/bus.ts';
import type {
  LlmCompleteInput,
  LlmCompleteResult,
  LlmRunInput,
  LlmRunResult,
  Purpose,
  ResolvedModel,
} from './llm/types.ts';
import type { Logger } from './log/logger.ts';
import type { Database } from './store/db.ts';

export interface LlmService {
  listProviders(): LlmConfigView;
  createEndpoint(input: CreateEndpointInput): Promise<CreateEndpointOutput>;
  updateEndpoint(input: UpdateEndpointInput): Promise<LlmConfigView>;
  removeEndpoint(input: RemoveEndpointInput): Promise<LlmConfigView>;
  addModel(input: AddModelInput): Promise<LlmConfigView>;
  updateModel(input: UpdateModelInput): Promise<LlmConfigView>;
  removeModel(input: RemoveModelInput): Promise<LlmConfigView>;
  setPurpose(input: SetPurposeInput): Promise<LlmConfigView>;
  testConnection(input: TestConnectionInput): Promise<TestConnectionResult>;
  resolve(purpose: Purpose): ResolvedModel | null;
  estimateTokens(text: string): number;
  run(input: LlmRunInput): Promise<LlmRunResult>;
  complete(input: LlmCompleteInput): Promise<LlmCompleteResult>;
  pruneCalls(): number;
}

export interface LibraryService {
  list(): WorkSummary[];
  create(input: WorkIdInput): WorkDetail;
  get(input: WorkIdInput): WorkDetail;
  saveBackground(input: SaveBackgroundInput): SaveBackgroundOutput;
  delete(input: WorkIdInput): Record<string, never>;
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
  getJournal(input: RouteIdInput): JournalView;
  recoverInterrupted(): number;
  pruneOldRequestLogs(): number;
  whenIdle(): Promise<void>;
}

export interface SettingsService {
  get(): Appearance;
  update(input: Appearance): Appearance;
}

export interface SummaryService {
  enqueue(turnId: string, routeId: string): void;
  backfill(): number;
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
  settings: SettingsService;
  summary: SummaryService;
  bus: EventBus;
  logger: Logger;
}

export interface ServiceFactories {
  llm(deps: CoreDeps): LlmService;
  library(deps: CoreDeps): LibraryService;
  settings(deps: CoreDeps): SettingsService;
  summary(deps: CoreDeps & { llm: LlmService }): SummaryService;
  authoring(deps: CoreDeps & { llm: LlmService }): AuthoringService;
  play(deps: CoreDeps & { llm: LlmService; summary: SummaryService }): PlayService;
}
