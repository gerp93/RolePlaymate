import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import CharacterList from './pages/CharacterList';
import CharacterDetail from './pages/CharacterDetail';
import Settings from './pages/Settings';
import Chat from './pages/Chat';
import Personas from './pages/Personas';
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
            <Route path="/personas" element={<Personas />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </Router>
    </ThemeProvider>
  );
}

export default App;
