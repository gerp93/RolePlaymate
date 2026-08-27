import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import CharacterList from './pages/CharacterList';
import CharacterDetail from './pages/CharacterDetail';
import Settings from './pages/Settings';
import Chat from './pages/Chat';
import PersonaList from './pages/PersonaList';
import PersonaDetail from './pages/PersonaDetail';
import WorldBookList from './pages/WorldBookList';
import WorldBookDetail from './pages/WorldBookDetail';
import Layout from './components/Layout';
import { ThemeProvider } from './context/ThemeContext';
import './themes.css';

function App() {
  return (
    <ThemeProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<CharacterList />} />
            <Route path="/characters/:characterId" element={<CharacterDetail />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/:conversationId" element={<Chat />} />
            <Route path="/personas" element={<PersonaList />} />
            <Route path="/personas/:personaId" element={<PersonaDetail />} />
            <Route path="/world-books" element={<WorldBookList />} />
            <Route path="/world-books/:lorebookId" element={<WorldBookDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </Router>
    </ThemeProvider>
  );
}

export default App;
