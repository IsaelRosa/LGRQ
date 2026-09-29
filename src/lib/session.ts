/**
 * Sessão do usuário (substitui o Supabase Auth no cliente).
 *
 * O token JWT é devolvido por `POST /api/auth/login` e reenviado em toda
 * chamada à API. Fica em `localStorage` para que a navegação entre páginas
 * não exija novo login.
 */

const CHAVE_TOKEN = 'lgrp.token';
const CHAVE_USUARIO = 'lgrp.usuario';

export type Usuario = {
  id: number;
  nome: string;
  email: string;
  papel: string;
  setor: string;
  crq: string;
  telefone: string;
  ativo: boolean;
};

function ler(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string) {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    /* modo privativo / storage bloqueado */
  }
}

function apagar(chave: string) {
  try {
    window.localStorage.removeItem(chave);
  } catch {
    /* noop */
  }
}

export function getToken(): string {
  return ler(CHAVE_TOKEN) || '';
}

export function getUsuario(): Usuario | null {
  const bruto = ler(CHAVE_USUARIO);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as Usuario;
  } catch {
    return null;
  }
}

export function setSessao(token: string, usuario: Usuario) {
  gravar(CHAVE_TOKEN, token);
  gravar(CHAVE_USUARIO, JSON.stringify(usuario));
}

export function updateUsuario(usuario: Usuario) {
  gravar(CHAVE_USUARIO, JSON.stringify(usuario));
}

export function clearSessao() {
  apagar(CHAVE_TOKEN);
  apagar(CHAVE_USUARIO);
}

/** Indica se a sessão provavelmente expirou (evita round-trip desnecessário). */
export function sessaoExpirada(): boolean {
  const token = getToken();
  if (!token) return true;
  const partes = token.split('.');
  if (partes.length !== 3) return true;
  try {
    const payload = JSON.parse(atob(partes[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp !== 'number') return false;
    return payload.exp <= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
