import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Classes, sections and subjects for dropdowns (loaded once per page).
export function useAcademicRefs() {
  const [refs, setRefs] = useState({ classes: [], sections: [], subjects: [] });
  useEffect(() => {
    Promise.all([
      api.get('/academics/classes').catch(() => []),
      api.get('/academics/sections').catch(() => []),
      api.get('/academics/subjects').catch(() => [])
    ]).then(([classes, sections, subjects]) => setRefs({ classes, sections, subjects }));
  }, []);
  return {
    ...refs,
    classOptions: refs.classes.map((c) => ({ value: String(c.id), label: c.name })),
    sectionOptions: refs.sections.map((s) => ({ value: String(s.id), label: `${s.class_name} - ${s.name}` })),
    subjectOptions: refs.subjects.map((s) => ({ value: String(s.id), label: s.name }))
  };
}

export const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
