import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { PullRequestDetail, Route } from '@prism/shared';

export async function api<T>(
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey ?? crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.error?.message ??
        `Request failed (${response.status}). Please retry.`,
    );
  }
  return response.json() as Promise<T>;
}

export function usePullRequestAction(
  id: string,
  action: 'assessments' | 'overrides',
) {
  const client = useQueryClient();
  const idempotencyKey = useRef<string | undefined>(undefined);
  return useMutation({
    mutationFn: (
      body: { route?: Route; reason?: string; actor?: string } = {},
    ) => {
      idempotencyKey.current ??= crypto.randomUUID();
      return api<PullRequestDetail>(
        `/api/pull-requests/${encodeURIComponent(id)}/${action}`,
        body,
        idempotencyKey.current,
      );
    },
    onSuccess: (pr) => {
      idempotencyKey.current = undefined;
      client.setQueryData(['pull-request', id], pr);
      void client.invalidateQueries({ queryKey: ['pull-requests'] });
      void client.invalidateQueries({ queryKey: ['audit-events'] });
      void client.invalidateQueries({ queryKey: ['reviewers'] });
    },
    onError: () => {
      idempotencyKey.current = undefined;
    },
  });
}
