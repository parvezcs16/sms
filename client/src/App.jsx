import { Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { LicenseProvider, useLicense } from './context/LicenseContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';

import LoginPage from './pages/LoginPage';
import LicenseActivationPage from './pages/LicenseActivationPage';
import LicenseLockedPage from './pages/LicenseLockedPage';
import DashboardPage from './pages/DashboardPage';
import StudentsPage from './pages/StudentsPage';
import StudentProfilePage from './pages/StudentProfilePage';
import TeachersPage from './pages/TeachersPage';
import TeacherProfilePage from './pages/TeacherProfilePage';
import StaffPage from './pages/StaffPage';
import AcademicsPage from './pages/AcademicsPage';
import TimetablePage from './pages/TimetablePage';
import AttendancePage from './pages/AttendancePage';
import ExamsPage from './pages/ExamsPage';
import ResultsPage from './pages/ResultsPage';
import AdmissionsPage from './pages/AdmissionsPage';
import HomeworkPage from './pages/HomeworkPage';
import DateSheetPage from './pages/DateSheetPage';
import LibraryPage from './pages/LibraryPage';
import TransportPage from './pages/TransportPage';
import InventoryPage from './pages/InventoryPage';
import EventsPage from './pages/EventsPage';
import AccountsPage from './pages/AccountsPage';
import AuditLogsPage from './pages/AuditLogsPage';
import RolesPage from './pages/RolesPage';
import FeesPage from './pages/FeesPage';
import PayrollPage from './pages/PayrollPage';
import ExpensesPage from './pages/ExpensesPage';
import CommunicationPage from './pages/CommunicationPage';
import ReportsPage from './pages/ReportsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import ParentPortalPage from './pages/ParentPortalPage';
import StudentPortalPage from './pages/StudentPortalPage';
import NotFoundPage from './pages/NotFoundPage';
import ProfilePage from './pages/ProfilePage';
import SupportPage from './pages/SupportPage';
import CertificatesPage from './pages/CertificatesPage';


const isTeacher = (u) => Boolean(u.teacher_id);

function Shell({ children, roles, module, allow }) {
  return (
    <ProtectedRoute roles={roles} module={module} allow={allow}>
      <ShellInner>{children}</ShellInner>
    </ProtectedRoute>
  );
}

function ShellInner({ children }) {
  const { user } = useAuth();
  if (!user) return null;
  return <AppShell>{children}</AppShell>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Shell><DashboardPage /></Shell>} />
      <Route path="/students" element={<Shell module="students"><StudentsPage /></Shell>} />
      <Route path="/students/:id" element={<Shell module="students"><StudentProfilePage /></Shell>} />
      <Route path="/teachers" element={<Shell module="teachers"><TeachersPage /></Shell>} />
      <Route path="/teachers/:id" element={<Shell module="teachers"><TeacherProfilePage /></Shell>} />
      <Route path="/staff" element={<Shell module="staff"><StaffPage /></Shell>} />
      <Route path="/academics" element={<Shell module="academics"><AcademicsPage /></Shell>} />
      <Route path="/timetable" element={<Shell module="timetable" allow={isTeacher}><TimetablePage /></Shell>} />
      <Route path="/attendance" element={<Shell module="attendance" allow={isTeacher}><AttendancePage /></Shell>} />
      <Route path="/exams" element={<Shell module="exams"><ExamsPage /></Shell>} />
      <Route path="/results" element={<Shell module="results" allow={isTeacher}><ResultsPage /></Shell>} />
      <Route path="/admissions" element={<Shell module="admissions"><AdmissionsPage /></Shell>} />
      <Route path="/homework" element={<Shell module="homework" allow={isTeacher}><HomeworkPage /></Shell>} />
      <Route path="/date-sheet" element={<Shell module={['results', 'exams']} allow={isTeacher}><DateSheetPage /></Shell>} />
      <Route path="/library" element={<Shell module="library"><LibraryPage /></Shell>} />
      <Route path="/transport" element={<Shell module="transport"><TransportPage /></Shell>} />
      <Route path="/inventory" element={<Shell module="inventory"><InventoryPage /></Shell>} />
      <Route path="/events" element={<Shell><EventsPage /></Shell>} />
      <Route path="/accounts" element={<Shell module={['accounts', 'fees', 'expenses', 'payroll']}><AccountsPage /></Shell>} />
      <Route path="/audit-logs" element={<Shell module="settings"><AuditLogsPage /></Shell>} />
      <Route path="/roles" element={<Shell module="users"><RolesPage /></Shell>} />
      <Route path="/fees" element={<Shell module="fees"><FeesPage /></Shell>} />
      <Route path="/payroll" element={<Shell module="payroll"><PayrollPage /></Shell>} />
      <Route path="/expenses" element={<Shell module="expenses"><ExpensesPage /></Shell>} />
      <Route path="/communication" element={<Shell module="communication"><CommunicationPage /></Shell>} />
      <Route path="/reports" element={<Shell module="reports"><ReportsPage /></Shell>} />
      <Route path="/users" element={<Shell module="users"><UsersPage /></Shell>} />
      <Route path="/settings" element={<Shell module="settings"><SettingsPage view="settings" /></Shell>} />
      <Route path="/backup" element={<Shell module="settings"><SettingsPage key="backup" view="backup" /></Shell>} />
      <Route path="/parent-portal" element={<Shell roles={['parent']}><ParentPortalPage /></Shell>} />
      <Route path="/student-portal" element={<Shell roles={['student']}><StudentPortalPage /></Shell>} />
      <Route path="/certificates" element={<Shell module="certificates"><CertificatesPage /></Shell>} />
      <Route path="/profile" element={<Shell><ProfilePage /></Shell>} />
      <Route path="/support" element={<Shell><SupportPage /></Shell>} />
      <Route path="*" element={<Shell><NotFoundPage /></Shell>} />
    </Routes>
  );
}

function LicenseGate({ children }) {
  const { status, loading } = useLicense();
  if (loading) return <div className="login-shell"><span className="muted">Loading…</span></div>;
  if (status.state === 'unactivated') return <LicenseActivationPage />;
  if (status.state === 'locked') return <LicenseLockedPage reason={status.reason} />;
  return children;
}

export default function App() {
  return (
    <LicenseProvider>
      <LicenseGate>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </LicenseGate>
    </LicenseProvider>
  );
}
