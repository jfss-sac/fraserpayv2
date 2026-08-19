
import { firestore } from '@/integrations/firebase/client';
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { toast } from 'sonner';

// Function to check if sample booths already exist
export const checkSampleBooths = async (): Promise<boolean> => {
  try {
    const boothsRef = collection(firestore, 'booths');
    const q = query(boothsRef, where('name', 'in', ['SAC Booth', "Ms Sinclair's Sandwiches"]));
    const boothsSnapshot = await getDocs(q);
    
    return !boothsSnapshot.empty && boothsSnapshot.size >= 2;
  } catch (error) {
    console.error('Error checking sample booths:', error);
    return false;
  }
};

// Function to create sample booths with products
export const createSampleBooths = async (): Promise<boolean> => {
  try {
    const boothsExist = await checkSampleBooths();
    
    if (boothsExist) {
      console.log('Sample booths already exist');
      return true;
    }
    
    console.log('Creating sample booths and products...');
    
    // Create SAC Booth
    const boothsRef = collection(firestore, 'booths');
    const sacBoothRef = await addDoc(boothsRef, {
      name: 'SAC Booth',
      description: 'Student Activity Council Booth',
      pin: '9247',
      sales: 0,
      members: [],
      created_at: new Date().toISOString()
    });
    
    // Create Ms Sinclair's Sandwiches
    const sandwichBoothRef = await addDoc(boothsRef, {
      name: "Ms Sinclair's Sandwiches",
      description: 'Homemade fresh sandwiches',
      pin: '3015',
      sales: 0,
      members: [],
      created_at: new Date().toISOString()
    });
    
    // Add products to SAC Booth
    const productsRef = collection(firestore, 'products');
    const sacProducts = [
      { name: 'School Hoodie', price: 3500, booth_id: sacBoothRef.id, created_at: new Date().toISOString() },
      { name: 'Spirit T-Shirt', price: 1500, booth_id: sacBoothRef.id, created_at: new Date().toISOString() },
      { name: 'Fraser Mug', price: 1000, booth_id: sacBoothRef.id, created_at: new Date().toISOString() },
      { name: 'Event Ticket', price: 500, booth_id: sacBoothRef.id, created_at: new Date().toISOString() }
    ];
    
    // Add products to Sandwich Booth
    const sandwichProducts = [
      { name: 'Cheese Sandwich', price: 350, booth_id: sandwichBoothRef.id, created_at: new Date().toISOString() },
      { name: 'Veggie Wrap', price: 400, booth_id: sandwichBoothRef.id, created_at: new Date().toISOString() },
      { name: 'Turkey & Swiss', price: 450, booth_id: sandwichBoothRef.id, created_at: new Date().toISOString() },
      { name: 'BLT Supreme', price: 500, booth_id: sandwichBoothRef.id, created_at: new Date().toISOString() },
      { name: 'Cookie', price: 150, booth_id: sandwichBoothRef.id, created_at: new Date().toISOString() },
      { name: 'Bottled Water', price: 100, booth_id: sandwichBoothRef.id, created_at: new Date().toISOString() }
    ];
    
    // Add all products
    const allProducts = [...sacProducts, ...sandwichProducts];
    
    for (const product of allProducts) {
      await addDoc(productsRef, product);
    }
    
    console.log('Sample booths and products created successfully!');
    toast.success('Sample booths created successfully');
    return true;
  } catch (error) {
    console.error('Error creating sample booths:', error);
    toast.error('Failed to create sample booths');
    return false;
  }
};
