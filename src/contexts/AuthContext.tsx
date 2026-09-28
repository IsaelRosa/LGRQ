import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import supabase from '../lib/supabase';
import { apiGet } from '../lib/api';

export type Perfil = {
  id: number | null;
  nome: string;
  email: string;
  papel: string;
  setor: string;
  crq: string;
  telefone: string;
  ativo: boolean;
};

type AuthCtx = {
  user: any | null;
  perfil: Perfil | null;
  session: any | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, nome: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  podeEditar: boolean;
  podeGerenciarUsuarios: boolean;
};

const AuthContext = createContext<AuthCtx>({
  user: null,
  perfil: null,
  session: null,
  loading: true,
  signIn: async () => ({}),
  signUp: async () => ({}),
  signOut: async () => {},
  podeEditar: true,
  podeGerenciarUsuarios: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);

  const carregarPerfil = async (email: string) => {
    try {
      const lista = await apiGet<any[]>('/api/usuarios');
      const encontrado = (lista || []).find(
        (u) => (u.email || '').toLowerCase() === email.toLowerCase()
      );
      if (encontrado) {
        setPerfil({
          id: encontrado.id,
          nome: encontrado.nome,
          email: encontrado.email,
          papel: encontrado.papel,
          setor: encontrado.setor || '',
          crq: encontrado.crq || '',
          telefone: encontrado.telefone || '',
          ativo: encontrado.ativo !== false,
        });
        return;
      }
    } catch {
      /* perfil opcional */
    }
    setPerfil({
      id: null,
      nome: email.split('@')[0].replace(/[._]/g, ' '),
      email,
      papel: 'Consultor',
      setor: '',
      crq: '',
      telefone: '',
      ativo: true,
    });
  };

  useEffect(() => {
    let ativo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      const s = data.session;
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.user?.email) carregarPerfil(s.user.email);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.user?.email) carregarPerfil(s.user.email);
      else setPerfil(null);
    });

    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: traduzirErro(error.message) };
    return {};
  };

  const signUp = async (email: string, password: string, nome: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: nome } },
    });
    if (error) return { error: traduzirErro(error.message) };
    try {
      await fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          email,
          papel: 'Técnico de Laboratório',
          setor: 'Laboratório de Gestão de Resíduos Perigosos',
          ativo: true,
        }),
      });
    } catch {
      /* não bloqueia o cadastro */
    }
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setPerfil(null);
  };

  const papel = perfil?.papel || 'Consultor';
  const podeEditar = papel !== 'Consultor';
  const podeGerenciarUsuarios = papel === 'Administrador';

  return (
    <AuthContext.Provider
      value={{
        user,
        perfil,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        podeEditar,
        podeGerenciarUsuarios,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function traduzirErro(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials'))
    return 'E-mail ou senha inválidos. Verifique os dados e tente novamente.';
  if (m.includes('already registered')) return 'Este e-mail já está cadastrado. Faça login.';
  if (m.includes('password')) return 'A senha deve ter no mínimo 6 caracteres.';
  if (m.includes('email')) return 'Informe um endereço de e-mail válido.';
  if (m.includes('rate limit')) return 'Muitas tentativas. Aguarde alguns instantes.';
  return msg;
}

export const useAuth = () => useContext(AuthContext);
