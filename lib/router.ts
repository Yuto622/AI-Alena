import { useEffect, useState } from 'react';

/** 依存ゼロのハッシュルーター。 #/ , #/student , #/student/m01 , #/teacher , #/pricing */
export function useHashRoute() {
  const get = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [route, setRoute] = useState(get);
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => setRoute(get());
    const onSession = () => bump((n) => n + 1);
    window.addEventListener('hashchange', on);
    window.addEventListener('uspace:session', onSession);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('uspace:session', onSession);
    };
  }, []);
  return route;
}

export function navigate(path: string) {
  location.hash = path.startsWith('/') ? path : `/${path}`;
  window.scrollTo({ top: 0 });
}
