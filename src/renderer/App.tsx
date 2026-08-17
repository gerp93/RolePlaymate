import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import CharacterList from './pages/CharacterList';
import CharacterDetail from './pages/CharacterDetail';
import Settings from './pages/Settings';
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
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </Router>
    </ThemeProvider>
  );
}

export default App;
