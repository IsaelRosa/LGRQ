import { clearSessao, getToken } from './session';

export class ErroApi extends Error {
  status: number;
  codigo?: string;
  constructor(message: string, status: number, codigo?: string) {
    super(message);
    this.status = status;
    this.codigo = codigo;
  }
}

/**
 * Dispara quando o servidor recusa a sessão. O AuthContext escuta este evento
 * para trocar a tela por /login automaticamente.
 */
export const EVENTO_SESSAO_EXPIRADA = 'lgrp:sessao-expirada';

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ErroApi('Falha de conexão com o servidor. Verifique sua rede.', 0);
  }

  if (!res.ok) {
    let msg = `Erro ${res.status} ao comunicar com o servidor.`;
    let codigo: string | undefined;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
      if (j?.codigo) codigo = j.codigo;
    } catch {
      /* corpo não-JSON */
    }
    if (res.status === 401) {
      clearSessao();
      window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_EXPIRADA));
    }
    throw new ErroApi(msg, res.status, codigo);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export const apiGet = <T = any>(path: string) => api<T>(path);
export const apiPost = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const apiPut = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const apiDelete = <T = any>(path: string, id: number | string) =>
  api<T>(path, { method: 'DELETE', body: JSON.stringify({ id }) });
