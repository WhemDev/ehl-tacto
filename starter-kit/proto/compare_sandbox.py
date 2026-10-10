"""Frozen-policy sandbox comparison; accepts D01/D02 only and never opens practice cases."""

import argparse
import hashlib
import json
import os
import statistics
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from arena_kit import ArenaClient
from arena_kit.cli import load_env
from proto import engine
from proto.variants import VARIANTS


def revision(ref):
    return subprocess.check_output(['git', 'rev-parse', ref], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', nargs='+', choices=['case:D01', 'case:D02'], default=['case:D02'])
    parser.add_argument('--variants', nargs='+', choices=sorted(VARIANTS), default=['A3', 'B1', 'A6'])
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--env-file', type=Path, default=Path('.env'))
    parser.add_argument('--data', type=Path, default=Path('../data'))
    parser.add_argument('--handfacts', action='store_true', help='Use legacy demo facts; default is generic evidence')
    args = parser.parse_args()
    if args.repeats < 1 or len(set(args.variants)) != len(args.variants):
        parser.error('Use positive repeats and distinct variant names')
    load_env(args.env_file)
    os.environ['ARENA_DATA'] = str(args.data.resolve())
    if not args.handfacts:
        from proto.practice import PracticeNegotiator, pkg
        if not pkg().tables():
            parser.error('Generic evidence requires the data package SQLite database')
        engine.Negotiator = PracticeNegotiator
    client = ArenaClient(timeout=25, retries=7)
    available = {c['case_id'] for c in client.cases('sandbox')}
    if not set(args.cases) <= available:
        parser.error('Requested cases are not available as sandbox demos')

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out = Path('proto/runs/comparisons') / f'{stamp}-{uuid.uuid4().hex[:8]}'
    out.mkdir(parents=True)
    source_paths = sorted(Path('proto').glob('*.py')) + sorted(Path('arena_kit').glob('*.py'))
    sources = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths}
    manifest = {
        'created_at': stamp, 'commit': revision('HEAD'), 'upstream_commit': revision('origin/tugra'),
        'source_sha256': sources, 'mode': 'handfacts' if args.handfacts else 'generic',
        'cases': args.cases, 'repeats': args.repeats, 'workers': args.workers,
        'variants': {v: asdict(VARIANTS[v][1]) for v in args.variants},
        'data_sha256': {str(p.relative_to(args.data)): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in sorted(args.data.rglob('*')) if p.suffix in {'.sqlite', '.db'} or p.name == 'facts.json'},
        'missing_score_treatment': 'Included as 0 in aggregate; raw official score stays null',
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    jobs = []
    for rep in range(args.repeats):
        shift = rep % len(args.variants)
        order = args.variants[shift:] + args.variants[:shift]
        jobs.extend((v, case, rep) for case in args.cases for v in order)

    def one(v, case, rep):
        started = time.monotonic()
        sid, result = None, {}
        try:
            sid, result = engine.play(case, VARIANTS[v][1], client=client,
                                      log_dir=out / 'logs' / v, quiet=True)
        except Exception as exc:
            # No new session retries: retain failed attempts in the comparison.
            result = {'error': type(exc).__name__, 'score': None}
        return {'variant': v, 'case': case, 'rep': rep, 'session': sid,
                'score': result.get('score'), 'deal': result.get('deal'),
                'c_deal': result.get('c_deal'), 'terms': result.get('terms'),
                'error': result.get('error'), 'end_reason': result.get('end_reason'),
                'elapsed_s': round(time.monotonic() - started, 2)}

    print(f'{len(jobs)} sandbox sessions; mode={manifest["mode"]}; output={out}', flush=True)
    rows = []
    with ThreadPoolExecutor(args.workers) as pool:
        futures = [pool.submit(one, *job) for job in jobs]
        for future in as_completed(futures):
            row = future.result()
            rows.append(row)
            with (out / 'results.jsonl').open('a') as stream:
                stream.write(json.dumps(row) + '\n')
            print(f'[{len(rows)}/{len(jobs)}] {row["variant"]} {row["case"]} rep{row["rep"]}: '
                  f'score={row["score"]} error={row["error"]}', flush=True)
    summary = []
    for case in args.cases:
        for v in args.variants:
            matches = [r for r in rows if r['variant'] == v and r['case'] == case]
            scores = [r['score'] if r['score'] is not None else 0.0 for r in matches]
            summary.append({'variant': v, 'case': case, 'n': len(scores), 'median': statistics.median(scores),
                            'mean': statistics.mean(scores), 'min': min(scores), 'max': max(scores),
                            'missing_scores': sum(r['score'] is None for r in matches),
                            'deals': sum(r['deal'] is True for r in matches)})
    (out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    for row in summary:
        print(json.dumps(row), flush=True)
    print(f'Artifacts: {out}', flush=True)


if __name__ == '__main__':
    main()
