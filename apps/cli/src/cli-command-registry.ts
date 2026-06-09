export interface CliCommandRoute<Context> {
  patterns: string[][];
  usage: string[];
  run(args: string[], context: Context): Promise<number>;
}

export interface MatchedCliCommand<Context> {
  route: CliCommandRoute<Context>;
  args: string[];
}

export function matchCliCommand<Context>(
  routes: CliCommandRoute<Context>[],
  args: string[]
): MatchedCliCommand<Context> | undefined {
  const sortedRoutes = [...routes].sort((left, right) =>
    longestPatternLength(right) - longestPatternLength(left)
  );

  for (const route of sortedRoutes) {
    for (const pattern of route.patterns) {
      if (matchesPattern(args, pattern)) {
        return {
          route,
          args: args.slice(pattern.length)
        };
      }
    }
  }

  return undefined;
}

export function routeUsageLines<Context>(
  routes: CliCommandRoute<Context>[]
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const route of routes) {
    for (const usage of route.usage) {
      if (!seen.has(usage)) {
        seen.add(usage);
        lines.push(usage);
      }
    }
  }
  return lines;
}

function longestPatternLength<Context>(route: CliCommandRoute<Context>): number {
  return Math.max(...route.patterns.map((pattern) => pattern.length));
}

function matchesPattern(args: string[], pattern: string[]): boolean {
  return pattern.length <= args.length &&
    pattern.every((segment, index) => args[index] === segment);
}
