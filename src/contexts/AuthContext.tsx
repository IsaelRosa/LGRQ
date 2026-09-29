import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, api, ErroApi, EVENTO_SESSAO_EXPIRADA } from '../lib/api';
import { clearSessao, getToken, setSessao, type Usuario } from '../lib/session';

export type { Usuario };

type AuthCtx = {
  user: Usuario | null;
  /** Alias de `user`, mantido porque boa parte das telas já referencia `perfil`. */
  perfil: Usuario | null;
  loading: boolean;
  signIn: (email: string, senha: string) => Promise<{ error?: string }>;
  signUp: (email: string, senha: string, nome: string) => Promise<{ error?: string; aviso?: string }>;
  signOut: () => Promise<void>;
  podeEditar: boolean;
  podeGerenciarUsuarios: boolean;
};

const AuthContext = createContext<AuthCtx>({
  user: null,
  perfil: null,
  loading: true,
  signIn: async () => ({}),
  signUp: async () => ({}),
  signOut: async () => {},
  podeEditar: false,
  podeGerenciarUsuarios: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  // Sem token não há nada a revalidar: iniciar como "carregando" só
  // causaria um render desnecessário antes de mostrar o /login.
  const [user, setUser] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(() => !!getToken());

  const encerrar = useCallback(() => {
    clearSessao();
    setUser(null);
  }, []);

  // Revalida a sessão guardada no navegador contra o servidor na carga da página.
  useEffect(() => {
    let ativo = true;

    if (!getToken()) return;

    apiGet<{ usuario: Usuario }>('/api/auth/me')
      .then((r) => {
        if (!ativo) return;
        setUser(r.usuario);
      })
      .catch(() => {
        if (!ativo) return;
        // O listener global abaixo já limpou a sessão em caso de 401.
        setUser(null);
      })
      .finally(() => {
        if (ativo) setLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, []);

  // Qualquer 401 vindo da API derruba a sessão uma única vez.
  useEffect(() => {
    const onExpirada = () => setUser(null);
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, onExpirada);
    return () => window.removeEventListener(EVENTO_SESSAO_EXPIRADA, onExpirada);
  }, []);

  const signIn = useCallback(async (email: string, senha: string) => {
    try {
      const r = await apiPost<{ token: string; usuario: Usuario }>('/api/auth/login', {
        email: email.trim(),
        senha,
      });
      setSessao(r.token, r.usuario);
      setUser(r.usuario);
      return {};
    } catch (e) {
      return { error: traduzirErro(e) };
    }
  }, []);

  const signUp = useCallback(async (email: string, senha: string, nome: string) => {
    try {
      const r = await apiPost<{ token: string; usuario: Usuario; aviso?: string }>(
        '/api/auth/register',
        { nome: nome.trim(), email: email.trim(), senha }
      );
      setSessao(r.token, r.usuario);
      setUser(r.usuario);
      return { aviso: r.aviso };
    } catch (e) {
      return { error: traduzirErro(e) };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/api/auth', { method: 'DELETE' });
    } catch {
      /* encerrar a sessão local é suficiente */
    }
    encerrar();
  }, [encerrar]);

  const papel = user?.papel || 'Consultor';
  const podeEditar = ['Administrador', 'Coordenador', 'Técnico de Laboratório'].includes(papel);
  const podeGerenciarUsuarios = papel === 'Administrador';

  return (
    <AuthContext.Provider
      value={{ user, perfil: user, loading, signIn, signUp, signOut, podeEditar, podeGerenciarUsuarios }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function traduzirErro(e: unknown): string {
  if (e instanceof ErroApi) return e.message;
  if (e instanceof Error) return e.message;
  return 'Não foi possível concluir a operação.';
}

export const useAuth = () => useContext(AuthContext);
