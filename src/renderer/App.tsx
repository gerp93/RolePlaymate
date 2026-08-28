import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import CharacterList from './pages/CharacterList';
import CharacterDetail from './pages/CharacterDetail';
import Settings from './pages/Settings';
import PromptSettings from './pages/PromptSettings';
import ModelTuning from './pages/ModelTuning';
import Chat from './pages/Chat';
import PersonaList from './pages/PersonaList';
import PersonaDetail from './pages/PersonaDetail';
import WorldBookList from './pages/WorldBookList';
import WorldBookDetail from './pages/WorldBookDetail';
import Layout from './components/Layout';
import { ThemeProvider } from './context/ThemeContext';
import { SecurityProvider } from './context/SecurityContext';
import './themes.css';

function App() {
  return (
    <ThemeProvider>
      <SecurityProvider>
        <Router>
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/characters" element={<CharacterList />} />
              <Route path="/characters/:characterId" element={<CharacterDetail />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/chat/:conversationId" element={<Chat />} />
              <Route path="/personas" element={<PersonaList />} />
              <Route path="/personas/:personaId" element={<PersonaDetail />} />
              <Route path="/world-books" element={<WorldBookList />} />
              <Route path="/world-books/:lorebookId" element={<WorldBookDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/prompt-tuning" element={<PromptSettings />} />
              <Route path="/model-tuning" element={<ModelTuning />} />
            </Routes>
          </Layout>
        </Router>
      </SecurityProvider>
    </ThemeProvider>
  );
}

export default App;
