import type { ParsedCommand } from '../scene/transformations/types';

export const parseCommandAPI = async (text: string): Promise<ParsedCommand> => {
  try {
    const response = await fetch('http://127.0.0.1:8000/api/parse-command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Failed to parse command');
    }
    
    return await response.json();
  } catch (err: any) {
    throw new Error(err.message || 'Backend is unavailable. Could not parse command.');
  }
};
