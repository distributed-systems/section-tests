import chalk from './lib/chalk.js';
function oneLine(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n/g, ' \\n ');
}
function suiteHeading(suitePath) {
    return suitePath.length ? suitePath.join(' > ') : '(root)';
}
function describeTest(test) {
    const head = suiteHeading(test.suitePath);
    return head ? `${head} > ${test.name}` : test.name;
}
function sortTestsForPlan(tests) {
    return [...tests].sort((a, b) => {
        const fa = a.file.localeCompare(b.file);
        if (fa !== 0)
            return fa;
        const sa = a.suitePath.join('\0').localeCompare(b.suitePath.join('\0'));
        if (sa !== 0)
            return sa;
        return a.name.localeCompare(b.name);
    });
}
function paintLogLevel(level, text) {
    switch (level) {
        case 'error':
            return chalk.red(text);
        case 'warn':
            return chalk.yellow(text);
        case 'success':
            return chalk.green(text);
        case 'notice':
            return chalk.cyan(text);
        default:
            return chalk.white(text);
    }
}
/**
 * Human- and agent-friendly plain output: colorful plan up front, then per-test detail printed
 * when each test finishes (phases and `test-log` grouped under that test). No box-drawing rules.
 * Enable with `--agent-output` or `SECTION_TESTS_AGENT_OUTPUT=1`.
 */
export default class AgentPlainReporter {
    constructor(_options) {
        this.pending = new Map();
        // Reserved for API parity with `SpecReporter`.
    }
    ensurePending(ev) {
        let p = this.pending.get(ev.testId);
        if (!p) {
            p = {
                file: ev.file,
                suitePath: [...ev.suitePath],
                testName: ev.testName,
                entries: [],
            };
            this.pending.set(ev.testId, p);
        }
        return p;
    }
    push(ev, entry) {
        this.ensurePending(ev).entries.push(entry);
    }
    onPlan(plan) {
        const lines = [];
        lines.push('');
        lines.push(chalk.bold.cyan('section-tests ')
            + chalk.dim('— ')
            + chalk.bold.white('agent output ')
            + chalk.dim('(grouped by test when each completes)'));
        lines.push(chalk.dim('cwd: ') + chalk.white(process.cwd()));
        lines.push(chalk.dim('files: ') + chalk.white(String(plan.files.length)) + chalk.dim('  ') + plan.files.map((f) => chalk.grey(f)).join(chalk.dim(', ')));
        lines.push(chalk.dim('total tests: ') + chalk.white(String(plan.tests.length)));
        lines.push('');
        const byFile = new Map();
        for (const t of sortTestsForPlan(plan.tests)) {
            const list = byFile.get(t.file) ?? [];
            list.push(t);
            byFile.set(t.file, list);
        }
        lines.push(chalk.bold.blue('PLAN ') + chalk.dim('by file, then suite'));
        for (const [file, tests] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            lines.push('');
            lines.push(chalk.yellow('▸ file ') + chalk.white(file));
            let lastSuite = '\0';
            for (const t of tests) {
                const suiteKey = t.suitePath.join('\0');
                if (suiteKey !== lastSuite) {
                    lastSuite = suiteKey;
                    lines.push(chalk.dim('  suite ') + chalk.cyan(suiteHeading(t.suitePath)));
                }
                const mode = t.mode === 'serial' ? chalk.yellow('serial') : chalk.green('parallel');
                lines.push(chalk.dim('    • ')
                    + chalk.white(t.name)
                    + chalk.dim('  id=')
                    + chalk.grey(t.id)
                    + chalk.dim('  ')
                    + mode
                    + chalk.dim(`  timeout=${t.timeout}ms`));
            }
        }
        lines.push('');
        lines.push(chalk.bold.blue('RESULTS ') + chalk.dim('(each block appears when that test finishes)'));
        lines.push('');
        console.log(lines.join('\n'));
    }
    onEvent(event) {
        const ev = event;
        switch (event.type) {
            case 'test-started':
                this.push(ev, {
                    kind: 'start',
                    workerId: event.workerId,
                    workerSlot: event.workerSlot,
                    mode: event.mode,
                });
                break;
            case 'phase-started':
                this.push(ev, { kind: 'phase', phase: event.phase, edge: 'started' });
                break;
            case 'phase-finished':
                this.push(ev, { kind: 'phase', phase: event.phase, edge: 'finished' });
                break;
            case 'test-log':
                this.push(ev, { kind: 'log', level: event.level, message: event.message });
                break;
            case 'test-timeout':
                this.push(ev, {
                    kind: 'timeout',
                    phase: event.timeout.phase,
                    timeoutMs: event.timeout.timeoutMs,
                });
                break;
            case 'worker-terminated':
                this.push(ev, {
                    kind: 'worker-terminated',
                    forced: event.workerTermination.forced,
                    reason: event.workerTermination.reason,
                    graceMs: event.workerTermination.graceMs,
                });
                break;
            case 'test-finished':
                this.printCompletedBlock(event);
                this.pending.delete(event.testId);
                break;
            default:
                break;
        }
    }
    printCompletedBlock(finished) {
        const p = this.pending.get(finished.testId);
        const entries = p?.entries ?? [];
        const label = describeTest({
            name: finished.testName,
            suitePath: finished.suitePath,
        });
        const slot = finished.workerSlot !== undefined ? String(finished.workerSlot) : '—';
        const passed = finished.status === 'passed';
        const ind = chalk.dim('  ');
        const lines = [];
        lines.push('');
        lines.push((passed ? chalk.green.bold('✔ ') : chalk.red.bold('✖ '))
            + chalk.bold.white(label)
            + chalk.dim(`  ${finished.workerId}  slot ${slot}`));
        lines.push(ind + chalk.grey(finished.file));
        for (const e of entries) {
            switch (e.kind) {
                case 'start':
                    lines.push(ind
                        + chalk.blue('start')
                        + chalk.dim('  mode=')
                        + chalk.white(e.mode)
                        + (e.workerSlot !== undefined ? chalk.dim(`  slot=${e.workerSlot}`) : ''));
                    break;
                case 'phase': {
                    const tag = e.edge === 'started' ? chalk.yellow('→') : chalk.green('←');
                    const ph = chalk.cyan(e.phase);
                    lines.push(ind + `  ${tag} ${ph} ${e.edge === 'started' ? chalk.dim('started') : chalk.dim('finished')}`);
                    break;
                }
                case 'log': {
                    const lvl = chalk.dim(`[${e.level}]`);
                    const body = paintLogLevel(e.level, oneLine(e.message));
                    lines.push(ind + `  ${lvl} ${body}`);
                    break;
                }
                case 'timeout':
                    lines.push(ind
                        + chalk.red.bold('timeout')
                        + chalk.dim(`  phase=${e.phase}  ${e.timeoutMs}ms`));
                    break;
                case 'worker-terminated':
                    lines.push(ind
                        + chalk.red.bold('worker')
                        + chalk.dim(`  forced=${String(e.forced)}  ${e.reason}  grace=${e.graceMs}ms`));
                    break;
                default:
                    break;
            }
        }
        const dur = chalk.white(`${finished.durationMs}ms`) + chalk.dim(`  prepare ${finished.prepareDurationMs}ms  teardown ${finished.teardownStatus}`);
        lines.push(ind + (passed ? chalk.green.bold('PASS ') : chalk.red.bold('FAIL ')) + dur);
        if (finished.failure) {
            lines.push(ind
                + chalk.red(finished.failure.name)
                + chalk.dim(': ')
                + chalk.yellow(oneLine(finished.failure.message)));
            if (finished.failure.stack) {
                for (const row of finished.failure.stack.split('\n').slice(0, 12)) {
                    lines.push(ind + chalk.grey(`  ${oneLine(row)}`));
                }
            }
        }
        console.log(lines.join('\n'));
    }
    onSummary(summary) {
        if (this.pending.size > 0) {
            console.log('');
            console.log(chalk.yellow.bold('! Tests without a finish event (buffer dump):'));
            for (const [id, p] of this.pending) {
                console.log(chalk.dim(`  ${id}  ${describeTest({ name: p.testName, suitePath: p.suitePath })}`));
                for (const e of p.entries) {
                    console.log(chalk.grey(`    ${JSON.stringify(e)}`));
                }
            }
            this.pending.clear();
        }
        const lines = [];
        lines.push('');
        lines.push(chalk.bold.white('SUMMARY'));
        lines.push(chalk.green(`passed ${summary.ok}`)
            + chalk.dim('  |  ')
            + (summary.failed ? chalk.red(`failed ${summary.failed}`) : chalk.dim(`failed ${summary.failed}`))
            + chalk.dim('  |  ')
            + chalk.white(`total ${summary.total}`)
            + chalk.dim('  |  ')
            + chalk.cyan(`${summary.durationMs}ms`)
            + chalk.dim('  |  ')
            + (summary.pass ? chalk.green.bold('OK') : chalk.red.bold('NOT OK')));
        const failed = summary.records.filter((r) => r.status !== 'passed');
        if (failed.length) {
            lines.push('');
            lines.push(chalk.red.bold('Failed tests'));
            for (const r of failed) {
                lines.push(chalk.dim('  • ') + chalk.yellow(describeTest(r.test)));
                if (r.failure) {
                    lines.push(chalk.red(`    ${r.failure.name}: `) + chalk.white(oneLine(r.failure.message)));
                }
            }
        }
        lines.push('');
        console.log(lines.join('\n'));
    }
    flush() {
        // Buffered output is tied to test completion; nothing to flush here.
    }
}
//# sourceMappingURL=AgentPlainReporter.js.map