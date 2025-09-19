import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const repoName = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : 'teacher-duty-roster';
  
  return {
    plugins: [react()],
    base: command === 'build' ? `/${repoName}/` : '/',
  }
})
