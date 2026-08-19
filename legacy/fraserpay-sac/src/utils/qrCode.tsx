
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { firestore } from '@/integrations/firebase/client';
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { toast } from 'sonner';

// Encode user data to QR code format - ensure consistent formatting
export const encodeUserData = (userId: string) => {
  return `USER:${userId}`;
};

// Generate QR code URL for a given data string
export const generateQRCode = (data: string) => {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;
};

// QR Code component for rendering QR codes
export const QRCodeComponent = ({ value, size = 200 }: { value: string, size?: number }) => {
  return <QRCodeSVG value={value} size={size} />;
};

// Validate QR code data with improved detection and logging
export const validateQRCode = (qrData: string) => {
  console.log('Validating QR code data:', qrData);
  
  if (!qrData || typeof qrData !== 'string') {
    console.error('Invalid QR code: empty or not a string');
    return { isValid: false, userId: null, type: 'unknown' };
  }
  
  // Check if it's a user QR code (case-insensitive)
  if (qrData.toUpperCase().startsWith('USER:')) {
    const userId = qrData.slice(5); // Remove 'USER:' prefix
    console.log('Found USER: format QR code with ID:', userId);
    return { isValid: true, userId, type: 'user' };
  }
  
  // If QR code data is a UUID, treat it as a user ID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(qrData)) {
    console.log('Found UUID format QR code:', qrData);
    return { isValid: true, userId: qrData, type: 'uuid' };
  }
  
  // Try detecting a student number (numeric string)
  if (/^\d+$/.test(qrData)) {
    console.log('Found potential student number format:', qrData);
    return { isValid: true, userId: qrData, type: 'student_number' };
  }
  
  console.error('Invalid QR code format:', qrData);
  // Default case - invalid QR code
  return { isValid: false, userId: null, type: 'unknown' };
};

// Get user data from QR code data with better error handling
export const getUserFromQRData = async (qrData: string) => {
  console.log('Getting user from QR data:', qrData);
  
  if (!qrData) {
    console.error('Empty QR data provided');
    toast.error('Invalid QR code');
    return null;
  }
  
  const validation = validateQRCode(qrData);
  
  if (validation.isValid && validation.userId) {
    try {
      let userData = null;
      
      // First try looking up by ID if the format suggests it's a UUID
      if (validation.type === 'user' || validation.type === 'uuid') {
        console.log('Querying Firebase for user ID:', validation.userId);
        const userRef = doc(firestore, 'users', validation.userId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          console.log('User found by ID:', userSnap.data());
          userData = { id: userSnap.id, ...userSnap.data() };
        } else {
          console.log('No user found by ID');
          toast.error('User not found');
        }
      }
      
      // If no user found and it looks like a student number, try that lookup
      if (!userData && (validation.type === 'student_number' || /^\d+$/.test(validation.userId))) {
        console.log('Looking up by student number:', validation.userId);
        const usersRef = collection(firestore, 'users');
        const q = query(usersRef, where('student_number', '==', validation.userId));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          console.log('User found by student number:', querySnapshot.docs[0].data());
          userData = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() };
        } else {
          console.log('No user found by student number');
          toast.error('User not found by student number');
        }
      }
      
      return userData;
    } catch (error) {
      console.error('Error fetching user from QR data:', error);
      toast.error('Error locating user');
      return null;
    }
  }
  
  toast.error('Invalid QR code format');
  return null;
};

// Find user by student number
export const findUserByStudentNumber = async (studentNumber: string) => {
  console.log('Looking up user by student number:', studentNumber);
  try {
    const usersRef = collection(firestore, 'users');
    const q = query(usersRef, where('student_number', '==', studentNumber));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      console.log('No user found with student number:', studentNumber);
      toast.error('Student not found');
      return null;
    }
    
    const userData = querySnapshot.docs[0].data();
    userData.id = querySnapshot.docs[0].id;
    
    console.log('User found by student number:', userData);
    return userData;
  } catch (error) {
    console.error('Error finding user by student number:', error);
    toast.error('Error looking up student');
    return null;
  }
};

export default QRCodeComponent;
