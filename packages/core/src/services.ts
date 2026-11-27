import type {
  AddModelInput,
  AdoptPreviewInput,
  AdoptPreviewOutput,
  AdoptStalePlanInput,
  Appearance,
  ConfirmPlanInput,
  CreateEndpointInput,
  CreateEndpointOutput,
  GeneratePlanInput,
  GeneratePreviewInput,
  JournalView,
  LlmConfigView,
  PlaythroughIdInput,
  PlaythroughView,
  PlanJobView,
  PreviewJobView,
  RemoveEndpointInput,
  RemoveModelInput,
  RemovePlanItemInput,
  RetryInput,
  RetryOpeningInput,
  RouteIdInput,
  RouteView,
  SaveDraftInput,
  SaveDraftOutput,
  SetPurposeInput,
  SetWizardStepInput,
  StartInfo,
  StartPlaythroughInput,
  StatusView,
  SubmitActionInput,
  TestConnectionInput,
  TestConnectionResult,
  TurnRequestView,
  UpdateEndpointInput,
  UpdateModelInput,
  UpdatePlanItemInput,
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
  saveDraft(input: SaveDraftInput): SaveDraftOutput;
  setWizardStep(input: SetWizardStepInput): Record<string, never>;
  delete(input: WorkIdInput): Record<string, never>;
}

export interface AuthoringService {
  generatePreview(input: GeneratePreviewInput): PreviewJobView;
  adoptPreview(input: AdoptPreviewInput): AdoptPreviewOutput;
  generatePlan(input: GeneratePlanInput): PlanJobView;
  adoptStalePlan(input: AdoptStalePlanInput): SaveDraftOutput;
  updatePlanItem(input: UpdatePlanItemInput): SaveDraftOutput;
  removePlanItem(input: RemovePlanItemInput): SaveDraftOutput;
  confirmPlan(input: ConfirmPlanInput): SaveDraftOutput;
  recoverInterrupted(): number;
  whenIdle(): Promise<void>;
}

export interface PlayService {
  getRoute(input: RouteIdInput): RouteView;
  submitAction(input: SubmitActionInput): TurnRequestView;
  retry(input: RetryInput): TurnRequestView;
  getJournal(input: RouteIdInput): JournalView;
  getStartInfo(input: WorkIdInput): StartInfo;
  start(input: StartPlaythroughInput): PlaythroughView;
  getPlaythrough(input: PlaythroughIdInput): PlaythroughView;
  retryOpening(input: RetryOpeningInput): PlaythroughView;
  getStatus(input: RouteIdInput): StatusView;
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
