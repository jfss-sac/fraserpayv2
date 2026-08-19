import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { useTransactions } from '@/contexts/transactions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import Layout from '@/components/Layout';
import ProductItem from '@/components/ProductItem';
import { CartItem, Product } from '@/types';
import { Scan, X, Check, User, Search, RefreshCw, Loader } from 'lucide-react';
import { validateQRCode, getUserFromQRData, findUserByStudentNumber } from '@/utils/qrCode';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import QRCodeScanner from '@/components/QRCodeScanner';
import { Alert, AlertDescription } from '@/components/ui/alert';

const BoothSell = () => {
  const { boothId } = useParams<{ boothId: string }>();
  const { user } = useAuth();
  const { getBoothById, processPurchase, fetchAllBooths } = useTransactions();
  const navigate = useNavigate();
  
  const [booth, setBooth] = useState<ReturnType<typeof getBoothById>>(undefined);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [customer, setCustomer] = useState<{ id: string; name: string; balance: number } | null>(null);
  const [activeTab, setActiveTab] = useState('sell');
  const [lookupMode, setLookupMode] = useState<'scan' | 'manual'>('scan');
  const [studentNumber, setStudentNumber] = useState('');
  const [isLoadingStudent, setIsLoadingStudent] = useState(false);
  const [isProcessingQR, setIsProcessingQR] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isProcessingTransaction, setIsProcessingTransaction] = useState(false);

  const refreshBoothData = async () => {
    if (!boothId) return;
    
    setIsRefreshing(true);
    try {
      await fetchAllBooths();
      
      const updatedBooth = getBoothById(boothId);
    //   console.log('Refreshed initiative data for sell page:', updatedBooth);
      setBooth(updatedBooth);
    } catch (error) {
      console.error('Error refreshing initiative data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (boothId) {
      refreshBoothData();
    }
  }, [boothId, getBoothById]);

  useEffect(() => {
    if (!booth) {
      console.log("Initiative not found or user doesn't have access");
    }
  }, [booth]);

  const handleProductSelect = (product: Product) => {
    const existingItem = cart.find(item => item.productId === product.id);
    
    if (existingItem) {
      const updatedCart = cart.map(item => 
        item.productId === product.id 
          ? { ...item, quantity: item.quantity + 1 } 
          : item
      );
      setCart(updatedCart);
    } else {
      setCart([...cart, { productId: product.id, product, quantity: 1 }]);
    }
  };

  const handleDecrement = (productId: string) => {
    const existingItem = cart.find(item => item.productId === productId);
    
    if (existingItem && existingItem.quantity > 1) {
      const updatedCart = cart.map(item => 
        item.productId === productId 
          ? { ...item, quantity: item.quantity - 1 } 
          : item
      );
      setCart(updatedCart);
    } else {
      const updatedCart = cart.filter(item => item.productId !== productId);
      setCart(updatedCart);
    }
  };

  const handleIncrement = (productId: string) => {
    const existingItem = cart.find(item => item.productId === productId);
    
    if (existingItem) {
      const updatedCart = cart.map(item => 
        item.productId === productId 
          ? { ...item, quantity: item.quantity + 1 } 
          : item
      );
      setCart(updatedCart);
    }
  };

  const handleQRCodeScanned = async (decodedText: string) => {
    console.log('QR code scanned in Initiative Sell page:', decodedText);
    
    if (isProcessingQR) {
      console.log('Already processing a QR code, ignoring duplicate scan');
      return;
    }
    
    setIsProcessingQR(true);
    setScanning(false);
    
    try {
      console.log('Processing QR code:', decodedText);
      const validation = validateQRCode(decodedText);
      console.log('QR code validation result:', validation);
      
      if (!validation.isValid || !validation.userId) {
        console.error('Invalid QR code validation result:', validation);
        toast.error('Invalid QR code format');
        return;
      }
      
      console.log('QR code validated, getting user data for ID:', validation.userId);
      const userData = await getUserFromQRData(decodedText);
      console.log('User data returned from getUserFromQRData:', userData);
      
      if (userData) {
        console.log('User data found:', userData);
        setCustomer({
          id: userData.id,
          name: userData.name,
          balance: userData.tickets
        });
        
        toast.success(`Found customer: ${userData.name}`);
      } else {
        console.error('User data not found for validated QR code');
        toast.error('Customer not found');
      }
    } catch (error) {
      console.error('Error processing QR code:', error);
      toast.error('Failed to process QR code');
    } finally {
      setTimeout(() => {
        setIsProcessingQR(false);
      }, 1000);
    }
  };

  const handleScanQR = () => {
    setScanning(true);
  };

  const handleStudentLookup = async () => {
    if (!studentNumber) {
      toast.error('Please enter a student number');
      return;
    }
    
    setIsLoadingStudent(true);
    
    try {
      const userData = await findUserByStudentNumber(studentNumber);
      
      if (userData) {
        setCustomer({
          id: userData.id,
          name: userData.name,
          balance: userData.tickets
        });
        toast.success(`Found customer: ${userData.name}`);
      } else {
        toast.error('Student not found');
        setCustomer(null);
      }
    } catch (error) {
      console.error('Error looking up student:', error);
      toast.error('Failed to look up student');
    } finally {
      setIsLoadingStudent(false);
    }
  };

  const handleConfirmPurchase = async () => {
    if (isProcessingTransaction) return;
    
    if (!customer || !booth || !user) {
      toast.error('Missing customer or booth information');
      return;
    }

    if (!user.id?.trim() || !user.name?.trim()) {
      toast.error('Seller ID and seller name are required to complete a booth sale');
      return;
    }
    
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    
    const total = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    
    if (customer.balance < total) {
      toast.error('Customer has insufficient balance');
      return;
    }
    
    setIsProcessingTransaction(true);
    
    try {
      const success = await processPurchase(
        booth.id,
        customer.id,
        customer.name,
        user.id,
        user.name,
        cart,
        booth.name
      );
      
      if (success) {
        setCustomer(prevCustomer => {
          if (!prevCustomer) return null;
          return {
            ...prevCustomer,
            balance: prevCustomer.balance - total
          };
        });
        
        setCart([]);
        
        setTimeout(() => {
          setCustomer(null);
          setStudentNumber('');
        }, 5000);
        
        toast.success(`Purchase of $${(total/100).toFixed(2)} completed successfully`);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to process purchase');
    } finally {
      setIsProcessingTransaction(false);
    }
  };

  const handleCancelSale = () => {
    setCart([]);
    setCustomer(null);
    setStudentNumber('');
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    
    if (value === 'dashboard') {
      navigate(`/booth/${boothId}`);
    } else if (value === 'transactions') {
      navigate(`/booth/${boothId}/transactions`);
    } else if (value === 'settings') {
      navigate(`/booth/${boothId}/settings`);
    }
  };

  const toggleLookupMode = () => {
    setLookupMode(prev => prev === 'scan' ? 'manual' : 'scan');
    setCustomer(null);
    setStudentNumber('');
  };

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

  const renderRefreshButton = () => {
    return (
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={refreshBoothData}
        disabled={isRefreshing}
        className="absolute top-4 right-4"
      >
        <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
      </Button>
    );
  };

  if (!booth) {
    return (
      <Layout title="Initiative not found" showBack>
        <div className="text-center py-10">
          <p className="text-muted-foreground">The initiative you're looking for could not be found</p>
          <Button 
            variant="link" 
            onClick={() => navigate('/dashboard')}
            className="mt-4"
          >
            Return to Dashboard
          </Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout 
      title={booth?.name || "Initiative"} 
      subtitle="Initiative Management" 
      showBack
    >
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="dashboard" className="tab-button">Dashboard</TabsTrigger>
          <TabsTrigger value="sell" className="tab-button">Sell</TabsTrigger>
          <TabsTrigger value="transactions" className="tab-button">History</TabsTrigger>
          <TabsTrigger value="settings" className="tab-button">Settings</TabsTrigger>
        </TabsList>
        
        <TabsContent value="sell" className="animate-fade-in mt-6">
          <div className="space-y-6">
            {customer && (
              <Card className="border-border/50 shadow-sm bg-white overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-medium">{customer.name}</h3>
                      <p className="text-sm text-muted-foreground">Student ID: {customer.id}</p>
                    </div>
                    
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Balance</div>
                      <div className="text-lg font-semibold text-green-600">${(customer.balance/100).toFixed(2)}</div>
                    </div>
                    
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={handleCancelSale}
                      className="ml-2 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {!customer ? (
              <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-border rounded-lg bg-muted/20">
                <div className="flex justify-center space-x-4 mb-6">
                  <Button 
                    variant={lookupMode === 'scan' ? 'default' : 'outline'} 
                    onClick={() => setLookupMode('scan')}
                    className="gap-2"
                  >
                    <Scan className="h-4 w-4" />
                    Scan QR Code
                  </Button>
                  <Button 
                    variant={lookupMode === 'manual' ? 'default' : 'outline'} 
                    onClick={() => setLookupMode('manual')}
                    className="gap-2"
                  >
                    <User className="h-4 w-4" />
                    Student Number
                  </Button>
                </div>
                
                {lookupMode === 'scan' ? (
                  scanning ? (
                    <QRCodeScanner 
                      onScan={handleQRCodeScanned} 
                      onClose={() => setScanning(false)}
                    />
                  ) : (
                    <>
                      <div className="w-24 h-24 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                        <Scan className="h-10 w-10 text-muted-foreground" />
                      </div>
                      
                      <p className="text-muted-foreground mb-6">
                        Scan customer's QR code to begin
                      </p>
                      
                      <Button 
                        onClick={handleScanQR}
                        disabled={isProcessingQR}
                        className="bg-indigo-600 hover:bg-indigo-700"
                      >
                        {isProcessingQR ? 'Processing...' : 'Start Scanner'}
                      </Button>
                    </>
                  )
                ) : (
                  <div className="w-full max-w-md">
                    <div className="w-24 h-24 rounded-full bg-muted/50 flex items-center justify-center mb-4 mx-auto">
                      <User className="h-10 w-10 text-muted-foreground" />
                    </div>
                    
                    <p className="font-bold mb-2 text-center">
                      Ensure Student Provides ID to Prove Identity Before Entering Student Number
                    </p>

                    <p className="text-muted-foreground mb-6 text-center">
                      Enter student number to find customer
                    </p>
                    
                    <div className="flex space-x-2 mb-4">
                      <Input
                        placeholder="Enter student number"
                        value={studentNumber}
                        onChange={(e) => setStudentNumber(e.target.value)}
                        className="flex-1"
                      />
                      <Button 
                        onClick={handleStudentLookup}
                        disabled={isLoadingStudent || !studentNumber}
                        className="bg-indigo-600 hover:bg-indigo-700"
                      >
                        {isLoadingStudent ? (
                          <div className="flex items-center">
                            <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                            Looking up...
                          </div>
                        ) : (
                          <>
                            <Search className="h-4 w-4 mr-2" />
                            Find
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <h3 className="font-medium">Select Products</h3>
                  
                  <ScrollArea className="h-[50vh] w-full pr-4 overflow-y-auto">
                    <div className="space-y-3 pb-20">
                      {booth.products.map(product => (
                        <ProductItem
                          key={product.id}
                          product={product}
                          quantity={cart.find(item => item.productId === product.id)?.quantity || 0}
                          onIncrement={() => handleProductSelect(product)}
                          onDecrement={() => handleDecrement(product.id)}
                          selectable
                        />
                      ))}
                    </div>
                  </ScrollArea>
                </div>
                
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-border/50 shadow-lg">
                  <div className="flex justify-between items-center mb-2 max-w-md mx-auto">
                    <div>
                      <div className="text-sm text-muted-foreground">Total Items</div>
                      <div className="font-medium">{totalItems} items</div>
                    </div>
                    
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Total Amount</div>
                      <div className="text-xl font-bold">${(totalAmount/100).toFixed(2)}</div>
                    </div>
                  </div>
                  
                  <Button
                    onClick={handleConfirmPurchase}
                    disabled={cart.length === 0 || isProcessingTransaction}
                    className="w-full max-w-md mx-auto bg-green-500 hover:bg-green-600 text-white"
                  >
                    {isProcessingTransaction ? (
                      <>
                        <Loader className="h-5 w-5 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Check className="h-5 w-5 mr-2" />
                        Confirm Purchase
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
      {renderRefreshButton()}
    </Layout>
  );
};

export default BoothSell;
