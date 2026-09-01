import type {
    PagePerception,
    PageStabilitySample,
    PerceptionStability,
} from '../contracts';

export type StablePerceptionStability = PerceptionStability & {
    consistency: 'consistent',
    state: 'stable'
};

export type StablePagePerception = PagePerception & {
    stability: StablePerceptionStability
};

/** 非 stable 分支刻意只暴露 diagnosticPerception，形成显式 narrowing 边界。 */
export type PageSettlingResult = {
    status: 'stable',
    perception: StablePagePerception,
    samples: PageStabilitySample[]
} | {
    status: 'budget-exhausted' | 'timed-out',
    diagnosticPerception: PagePerception,
    reason: string,
    samples: PageStabilitySample[]
};

export interface PageSettlerRuntime {
    canContinue: () => boolean;
    pause: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    recapture: (
        previous: PagePerception,
        signal: AbortSignal
    ) => Promise<PagePerception>;
    sample: (signal: AbortSignal) => Promise<PageStabilitySample>;
}

export interface PageSettlerOptions {
    maxPerceptionRecaptures: number;
    maxStabilitySamples: number;
    pollIntervalsMs: number[];
    requiredConsecutiveStableSamples: number;
}

const DEFAULT_OPTIONS: PageSettlerOptions = {
    maxPerceptionRecaptures: 3,
    maxStabilitySamples: 6,
    pollIntervalsMs: [ 100, 200, 400, 500 ],
    requiredConsecutiveStableSamples: 2
};

/** 用低成本采样等待页面稳定，再以完整、带一致性 guard 的 capture 收口。 */
export class PageSettler {
    constructor(
        private readonly runtime: PageSettlerRuntime,
        private readonly options: PageSettlerOptions = DEFAULT_OPTIONS
    ) {}

    public async settle(
        initial: PagePerception,
        signal: AbortSignal
    ): Promise<PageSettlingResult> {
        if (isStablePagePerception(initial)) {
            return { status: 'stable', perception: initial, samples: [] };
        }
        const samples: PageStabilitySample[] = [];
        let diagnostic = initial;
        let previousFingerprint: string | undefined;
        let consecutiveStable = 0;
        let recaptures = 0;
        for (let index = 0; index < this.options.maxStabilitySamples; index += 1) {
            signal.throwIfAborted();
            if (!this.runtime.canContinue()) {
                return {
                    status: 'budget-exhausted',
                    diagnosticPerception: diagnostic,
                    reason: '页面稳定性等待期间全局时间预算已经耗尽。',
                    samples
                };
            }
            if (index > 0) {
                await this.runtime.pause(this.pollInterval(index - 1), signal);
            }
            const sample = await this.runtime.sample(signal);
            samples.push(sample);
            const quiet = !sample.loading && sample.transientSignals.length === 0;
            consecutiveStable = quiet && sample.fingerprint === previousFingerprint
                ? consecutiveStable + 1
                : quiet ? 1 : 0;
            previousFingerprint = sample.fingerprint;
            if (
                consecutiveStable <
                    this.options.requiredConsecutiveStableSamples
                || recaptures >= this.options.maxPerceptionRecaptures
            ) {
                continue;
            }
            recaptures += 1;
            diagnostic = await this.runtime.recapture(diagnostic, signal);
            if (isStablePagePerception(diagnostic)) {
                return {
                    status: 'stable',
                    perception: diagnostic,
                    samples
                };
            }
            consecutiveStable = 0;
            previousFingerprint = undefined;
        }
        return {
            status: 'timed-out',
            diagnosticPerception: diagnostic,
            reason: '页面在 bounded stability window 内没有形成一致稳定快照。',
            samples
        };
    }

    private pollInterval(index: number): number {
        return this.options.pollIntervalsMs[Math.min(
            index,
            this.options.pollIntervalsMs.length - 1
        )] ?? 0;
    }
}

/** legacy 缺失 stability 与 unknown 都不能越过 stable narrowing boundary。 */
export function isStablePagePerception(
    perception: PagePerception
): perception is StablePagePerception {
    return perception.stability?.consistency === 'consistent'
        && perception.stability.state === 'stable';
}
