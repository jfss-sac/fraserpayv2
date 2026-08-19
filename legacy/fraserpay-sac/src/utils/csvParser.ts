
/**
 * Parse CSV data into an array of objects
 * @param csvText Raw CSV text
 * @returns Array of objects where keys are column headers and values are cell values
 */
export const parseCSV = (csvText: string): Record<string, string>[] => {
  try {
    // Split the CSV by lines
    const lines = csvText.split(/\r\n|\n/);
    if (lines.length < 2) {
      throw new Error('CSV must have at least a header row and one data row');
    }

    // Extract headers (first row)
    const headers = lines[0].split(',').map(header => header.trim());
    
    // Parse data rows
    const data: Record<string, string>[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines
      
      // Handle quoted values that might contain commas
      const values: string[] = [];
      let inQuotes = false;
      let currentValue = '';
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      
      // Add the last value
      values.push(currentValue.trim());
      
      // Create object from headers and values
      if (values.length === headers.length) {
        const rowObject: Record<string, string> = {};
        headers.forEach((header, index) => {
          // Remove quotes from values if present
          const value = values[index].replace(/^"|"$/g, '');
          rowObject[header] = value;
        });
        data.push(rowObject);
      }
    }
    
    return data;
  } catch (error) {
    console.error('Error parsing CSV:', error);
    throw new Error('Failed to parse CSV file');
  }
};

/**
 * Validates if the CSV data has all required fields for users
 */
export const validateUserCSV = (data: Record<string, string>[]): { isValid: boolean; message?: string } => {
  if (data.length === 0) {
    return { isValid: false, message: 'CSV file is empty' };
  }
  
  const requiredFields = ['studentNumber', 'name', 'email', 'role'];
  const firstRow = data[0];
  
  const missingFields = requiredFields.filter(field => !Object.keys(firstRow).includes(field));
  
  if (missingFields.length > 0) {
    return { 
      isValid: false, 
      message: `Missing required fields: ${missingFields.join(', ')}` 
    };
  }
  
  return { isValid: true };
};

/**
 * Validates if the CSV data has all required fields for booths
 */
export const validateBoothCSV = (data: Record<string, string>[]): { isValid: boolean; message?: string } => {
  if (data.length === 0) {
    return { isValid: false, message: 'CSV file is empty' };
  }
  
  const firstRow = data[0];
  let requiredFields: string[];
  
  // Check if this is a booth with products CSV by looking for product fields
  const hasProductFields = Object.keys(firstRow).some(key => key.includes('product'));
  
  if (hasProductFields) {
    requiredFields = ['name', 'description', 'pin'];
  } else {
    requiredFields = ['name', 'description', 'pin'];
  }
  
  const missingFields = requiredFields.filter(field => !Object.keys(firstRow).includes(field));
  
  if (missingFields.length > 0) {
    return { 
      isValid: false, 
      message: `Missing required fields: ${missingFields.join(', ')}` 
    };
  }
  
  return { isValid: true };
};

/**
 * Create sample CSV templates for download
 */
export const generateUserCSVTemplate = (): string => {
  return 'studentNumber,name,email,role,tickets\n' +
    '123456,John Doe,john@example.com,student,500\n' +
    '789012,Jane Smith,jane@example.com,student,1000\n' +
    '345678,Admin User,admin@example.com,admin,0';
};

export const generateBoothCSVTemplate = (): string => {
  return 'name,description,pin\n' +
    'Food Booth,Delicious food items available here,1234\n' +
    'Game Booth,Play fun games and win prizes,5678\n' +
    'Craft Booth,Creative crafts and DIY activities,9012';
};

/**
 * Create sample CSV template for booths with products
 */
export const generateBoothWithProductsCSVTemplate = (): string => {
  return 'name,description,pin,product_name,product_price,product_image\n' +
    'Food Booth,Delicious food items,1234,Hot Dog,5.99,\n' +
    'Drink Booth,Refreshing beverages,5678,Soda,2.50,\n' +
    'Game Booth,Fun games and prizes,9012,Game Ticket,1.00,';
};

/**
 * Convert template to Blob for download
 */
export const downloadCSVTemplate = (templateContent: string, filename: string): void => {
  try {
    // Create a blob with the content
    const blob = new Blob([templateContent], { type: 'text/csv;charset=utf-8;' });
    
    // Create a temporary link element
    const link = document.createElement('a');
    
    // Create a URL for the blob
    const url = URL.createObjectURL(blob);
    
    // Set link attributes
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    // Add to document, click to download, then remove
    document.body.appendChild(link);
    link.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
    
    console.log('CSV download initiated for:', filename);
  } catch (error) {
    console.error('Error downloading CSV:', error);
  }
};
