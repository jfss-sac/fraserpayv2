
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { QrCode, Search } from 'lucide-react';
import { toast } from 'sonner';
import { firestore } from '@/integrations/firebase/client';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { encodeUserData, generateQRCode, getUserFromQRData } from '@/utils/qrCode';
import QRCodeScanner from '@/components/QRCodeScanner';

interface StudentSearchProps {
  onStudentFound: (student: any, qrCodeUrl: string) => void;
}

const StudentSearch: React.FC<StudentSearchProps> = ({ onStudentFound }) => {
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // Add state to prevent duplicate processing

  const handleStudentSearch = async () => {
    if (!studentSearchTerm.trim()) {
      toast.error('Please enter a student ID or name to search');
      return;
    }
    
    setIsSearching(true);
    
    try {
      console.log('Searching for student in Firebase:', studentSearchTerm);
      const usersRef = collection(firestore, 'users');
      
      // Create a query to search by student number, name, or email
      const q = query(
        usersRef,
        where('student_number', '==', studentSearchTerm)
      );
      
      // For case-insensitive name/email search, we need separate queries
      const querySnapshot = await getDocs(q);
      
      // If no results with exact student number, try name and email
      if (querySnapshot.empty) {
        console.log('No exact match on student number, searching by name and email');
        // We need to get all users and filter manually for partial matches
        const allUsersSnapshot = await getDocs(collection(firestore, 'users'));
        
        const matchingUsers = allUsersSnapshot.docs.filter(doc => {
          const data = doc.data();
          const searchTermLower = studentSearchTerm.toLowerCase();
          
          return (
            (data.name && data.name.toLowerCase().includes(searchTermLower)) ||
            (data.email && data.email.toLowerCase().includes(searchTermLower))
          );
        });
        
        if (matchingUsers.length > 0) {
          const userData = matchingUsers[0].data();
          userData.id = matchingUsers[0].id;
          
          handleStudentFound(userData);
        } else {
          console.log('No student found with search term:', studentSearchTerm);
          toast.error('No student found with that ID, name, or email');
        }
      } else {
        // Found by student number
        const userData = querySnapshot.docs[0].data();
        userData.id = querySnapshot.docs[0].id;
        
        handleStudentFound(userData);
      }
    } catch (error) {
      console.error('Error in student search:', error);
      toast.error('Failed to search for student');
    } finally {
      setIsSearching(false);
    }
  };

  const handleScanQRCode = () => {
    setIsScanning(true);
  };

  const handleQRCodeScanned = async (decodedText: string) => {
    console.log('QR code scanned with data:', decodedText);
    
    // Prevent duplicate processing
    if (isProcessing) {
      console.log('Already processing a QR code, ignoring duplicate scan');
      return;
    }
    
    setIsProcessing(true);
    setIsScanning(false);
    
    try {
      // Case insensitive handling of QR code format
      const userData = await getUserFromQRData(decodedText);
      
      if (userData) {
        const foundStudent = {
          id: userData.id,
          name: userData.name,
          studentNumber: userData.student_number,
          email: userData.email,
          balance: userData.tickets / 100,
          qrCode: userData.qr_code || decodedText
        };
        
        // Generate QR code SVG
        let qrCodeSvg = generateQRCode(decodedText);
        
        toast.success(`Found student: ${userData.name}`);
        onStudentFound(foundStudent, qrCodeSvg);
      } else {
        toast.error('Invalid QR code or student not found');
      }
    } catch (error) {
      console.error('Error processing scanned QR code:', error);
      toast.error('Error processing QR code');
    } finally {
      // Reset processing state after a short delay
      setTimeout(() => {
        setIsProcessing(false);
      }, 1000);
    }
  };

  const handleStudentFound = (userData: any) => {
    const foundStudent = {
      id: userData.id,
      name: userData.name,
      studentNumber: userData.student_number,
      email: userData.email,
      balance: userData.tickets / 100,
      qrCode: userData.qr_code
    };
    
    // Generate or use existing QR code
    let qrCodeData = userData.qr_code || encodeUserData(userData.id);
    let qrCodeSvg = generateQRCode(qrCodeData);
    
    console.log('Found student:', foundStudent);
    
    onStudentFound(foundStudent, qrCodeSvg);
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Student Search</CardTitle>
        <CardDescription>
          Find a student to view their details or manage their account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isScanning ? (
          <QRCodeScanner 
            onScan={handleQRCodeScanned} 
            onClose={() => setIsScanning(false)}
          />
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <Input
                placeholder="Search by student ID, name, or email..."
                value={studentSearchTerm}
                onChange={(e) => setStudentSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStudentSearch()}
                className="w-full"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleStudentSearch} disabled={isSearching} className="flex-1 sm:flex-none">
                {isSearching ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Search
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleScanQRCode} disabled={isScanning || isProcessing} className="flex-1 sm:flex-none">
                <QrCode className="h-4 w-4 mr-2" />
                Scan QR
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StudentSearch;
