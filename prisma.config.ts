import { defineConfig } from '@prisma/config';
import dotenv from 'dotenv';

// Explicitly load the .env file into process.env
dotenv.config();

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL, 
  },
});