import type {
  AddModelInput,
  AdoptPreviewInput,
  AdoptPreviewOutput,
  AdoptStalePlanInput,
  Appearance,
  ApplyDraftInput,
  AutoIllustrationTarget,
  AutoIllustrationView,
  ConfirmPlanInput,
  ContinueWakeInput,
  CreateEndpointInput,
  CreateEndpointOutput,
  CreateImageServiceInput,
  CreateImageServiceOutput,
  DismissIllustrationInput,
  GeneratePlanInput,
  GeneratePreviewInput,
  ImportNovelInput,
  GeneratedToken,
  ImageCapabilities,
  ImageConfigView,
  ImageFileInput,
  ImageStorageSummary,
  ImageUsageSummary,
  IllustrationActionInput,
  IllustrationView,
  JournalView,
  LlmConfigView,
  LlmLogDetail,
  LlmLogIdInput,
  LlmLogList,
  LlmLogListInput,
  OutputOptionsView,
  OutputPreferences,
  PlaythroughIdInput,
  PlaythroughListItem,
  PlaythroughView,
  PlanJobView,
  PortraitAdoptInput,
  PortraitDraftInput,
  PortraitDraftView,
  PortraitGenerateInput,
  PortraitGetInput,
  PortraitPreviewInput,
  PortraitSetView,
  PortraitUpdateInput,
  PortraitUploadInput,
  PrewarmInput,
  PreviewJobView,
  RemoveEndpointInput,
  RemoveImageServiceInput,
  RemoveModelInput,
  RemovePlanItemInput,
  RetryInput,
  RetryOpeningInput,
  RouteIdInput,
  RouteView,
  SaveDraftInput,
  SaveDraftOutput,
  SelectImageServiceInput,
  SetAutoIllustrationInput,
  SetIllustrationStyleInput,
  SetPurposeInput,
  SetWizardStepInput,
  StartInfo,
  StartPlaythroughInput,
  StatusView,
  SubmitActionInput,
  SuggestAppearanceInput,
  SuggestAppearanceOutput,
  TestConnectionInput,
  TestConnectionResult,
  TestImageServiceInput,
  TestImageServiceResult,
  TurnRequestView,
  UpdateEndpointInput,
  UpdateImageServiceInput,
  UpdateModelInput,
  UpdatePlanItemInput,
  WorkDetail,
  WorkIdInput,
  WorkSummary,
} from '@unwritten/contracts';
import type { EventBus } from './events/bus.ts';
import type { ImageDispatchGuard, ImageGenerateInput, ImageGenerateResult } from './image/engine-types.ts';
import type {
  LlmCompleteInput,
  LlmCompleteResult,
  LlmRunInput,
  LlmRunResult,
  Purpose,
  ResolvedModel,
} from './llm/types.ts';
import type { Logger } from './log/logger.ts';
import type { ProvidersStore } from './providers/file.ts';
import type { Database } from './store/db.ts';
import type { PlaythroughIllustration } from './store/illustration-types.ts';
import type { StoryProjection } from './story/types.ts';
import type { StoryTx } from './story/writer.ts';

export { ImageError } from './image/errors.ts';
export type { ImageDispatchGuard, ImageGenerateInput, ImageGenerateResult } from './image/engine-types.ts';
export { readIllustrationSettings } from './image/settings.ts';
export { appearanceHash } from './illustration/appearance.ts';
export { PORTRAIT_PREVIEW_TTL_DAYS } from './illustration/constants.ts';
export { illustrationEnabled } from './illustration/enqueue.ts';
export { effectiveStyle } from './illustration/style.ts';
export type { StoryTx } from './story/writer.ts';

export interface IllustrationQueueInput {
  turnId: string;
  playthroughId: string;
  para: number;
  settings: PlaythroughIllustration;
  now: number;
}

export interface JournalPortraitsInput {
  routeId: string;
  projection: StoryProjection;
  settings: PlaythroughIllustration;
  playthroughId: string;
}

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
  listLogs(input: LlmLogListInput): LlmLogList;
  getLog(input: LlmLogIdInput): LlmLogDetail;
  resolve(purpose: Purpose): ResolvedModel | null;
  estimateTokens(text: string): number;
  run(input: LlmRunInput): Promise<LlmRunResult>;
  complete(input: LlmCompleteInput): Promise<LlmCompleteResult>;
  pruneCalls(): number;
}

export interface ImageService {
  listServices(): ImageConfigView;
  createService(input: CreateImageServiceInput): Promise<CreateImageServiceOutput>;
  updateService(input: UpdateImageServiceInput): Promise<ImageConfigView>;
  removeService(input: RemoveImageServiceInput): Promise<ImageConfigView>;
  generateToken(): GeneratedToken;
  testService(input: TestImageServiceInput): Promise<TestImageServiceResult>;
  select(input: SelectImageServiceInput): Promise<ImageConfigView>;
  getOutputOptions(): OutputOptionsView;
  setOutputPreferences(input: OutputPreferences): OutputOptionsView;
  getAutoIllustration(): AutoIllustrationView;
  setAutoIllustration(input: SetAutoIllustrationInput): AutoIllustrationView;
  activeTarget(): AutoIllustrationTarget | null;
  prepareGeneration(
    serviceId: string,
    input: { manual: boolean; signal: AbortSignal; onWaiting?: () => void; guard?: ImageDispatchGuard },
  ): Promise<ImageCapabilities>;
  selectedServiceId(): string | null;
  capabilities(serviceId: string): ImageCapabilities | null;
  assertFormat(capabilities: ImageCapabilities, format: Pick<ImageGenerateInput, 'aspect' | 'size' | 'quality'>): void;
  generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
  wake(serviceId: string, trigger: 'prewarm' | 'demand'): void;
  continueWake(input: ContinueWakeInput): Promise<Record<string, never>>;
  usageSummary(): ImageUsageSummary;
  pruneCalls(): number;
  whenIdle(): Promise<void>;
}

export interface IllustrationService {
  retry(input: IllustrationActionInput): IllustrationView;
  reroll(input: IllustrationActionInput): IllustrationView;
  dismiss(input: DismissIllustrationInput): IllustrationView;
  portraitDraft(input: PortraitDraftInput): PortraitDraftView;
  portraitGet(input: PortraitGetInput): PortraitSetView;
  portraitUpload(input: PortraitUploadInput): Promise<PortraitSetView>;
  portraitGenerate(input: PortraitGenerateInput): PortraitSetView;
  portraitUpdate(input: PortraitUpdateInput): PortraitSetView;
  portraitAdopt(input: PortraitAdoptInput): PortraitDraftView;
  portraitPreview(input: PortraitPreviewInput): PortraitSetView;
  file(input: ImageFileInput): Promise<File>;
  storageSummary(): ImageStorageSummary;
  prewarm(input: PrewarmInput): Record<string, never>;
  suggestAppearance(input: SuggestAppearanceInput): Promise<SuggestAppearanceOutput>;
  setWorkStyle(input: SetIllustrationStyleInput): Record<string, never>;
  enqueue(tx: StoryTx, input: IllustrationQueueInput): string;
  forRoute(routeId: string): Map<string, IllustrationView>;
  journalPortraits(input: JournalPortraitsInput): Map<string, { setId: string; updatedAt: number }>;
  recoverInterrupted(): number;
  prepareStorage(): Promise<void>;
  collectGarbage(): Promise<void>;
  kick(): void;
  whenIdle(): Promise<void>;
}

export interface LibraryService {
  list(): WorkSummary[];
  create(input: WorkIdInput): WorkDetail;
  get(input: WorkIdInput): WorkDetail;
  novelChapters(input: WorkIdInput): string[];
  saveDraft(input: SaveDraftInput): SaveDraftOutput;
  setWizardStep(input: SetWizardStepInput): Record<string, never>;
  delete(input: WorkIdInput): Record<string, never>;
}

export interface AuthoringService {
  importNovel(input: ImportNovelInput): Promise<WorkIdInput>;
  generatePreview(input: GeneratePreviewInput): PreviewJobView;
  adoptPreview(input: AdoptPreviewInput): AdoptPreviewOutput;
  applyDraft(input: ApplyDraftInput): SaveDraftOutput;
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
  listPlaythroughs(input: WorkIdInput): PlaythroughListItem[];
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
  providers?: ProvidersStore;
}

export interface Services {
  llm: LlmService;
  image: ImageService;
  illustration: IllustrationService;
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
  image(deps: CoreDeps & { llm: LlmService }): ImageService;
  illustration(deps: CoreDeps & { llm: LlmService; image: ImageService }): IllustrationService;
  library(deps: CoreDeps & { onWorkDeleted?: () => void }): LibraryService;
  settings(deps: CoreDeps): SettingsService;
  summary(deps: CoreDeps & { llm: LlmService }): SummaryService;
  authoring(deps: CoreDeps & { llm: LlmService }): AuthoringService;
  play(
    deps: CoreDeps & {
      llm: LlmService;
      summary: SummaryService;
      image: ImageService;
      illustration: IllustrationService;
      onIllustrationQueued: () => void;
    },
  ): PlayService;
}
