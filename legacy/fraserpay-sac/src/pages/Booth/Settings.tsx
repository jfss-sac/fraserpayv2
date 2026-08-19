import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { useTransactions } from '@/contexts/transactions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Layout from '@/components/Layout';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { AlertCircle, Copy, Trash, Plus, Package } from 'lucide-react';
import { Product } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import ProductItem from '@/components/ProductItem';
import { uniqueToast } from '@/utils/toastHelpers';
const BoothSettings = () => {
  const {
    boothId
  } = useParams<{
    boothId: string;
  }>();
  const {
    user
  } = useAuth();
  const {
    getBoothById,
    deleteBooth,
    addProductToBooth,
    removeProductFromBooth
  } = useTransactions();
  const navigate = useNavigate();
  const [booth, setBooth] = useState<ReturnType<typeof getBoothById>>(undefined);
  const [activeTab, setActiveTab] = useState('settings');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [addProductDialogOpen, setAddProductDialogOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const productForm = useForm({
    defaultValues: {
      name: '',
      price: '',
      description: ''
    }
  });
  useEffect(() => {
    if (boothId) {
      const boothData = getBoothById(boothId);
      setBooth(boothData);
      if (boothData && boothData.products) {
        setProducts(boothData.products);
      }
    }
  }, [boothId, getBoothById]);
  useEffect(() => {
    if (!booth) {
      console.log("Initiative not found or user doesn't have access");
    }
  }, [booth]);
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value === 'dashboard') {
      navigate(`/booth/${boothId}`);
    } else if (value === 'sell') {
      navigate(`/booth/${boothId}/sell`);
    } else if (value === 'transactions') {
      navigate(`/booth/${boothId}/transactions`);
    }
  };
  const handleCopyPin = () => {
    if (booth) {
      navigator.clipboard.writeText(booth.pin);
      uniqueToast.success('PIN code copied to clipboard');
    }
  };
  const handleDeleteBooth = async () => {
    setIsDeleting(true);
    if (boothId) {
      try {
        const success = await deleteBooth(boothId);
        if (success) {
          uniqueToast.success('Initiative deleted successfully');
          navigate('/dashboard');
        } else {
          uniqueToast.error('Failed to delete initiative');
        }
      } catch (error) {
        console.error('Error deleting initiative:', error);
        uniqueToast.error('Failed to delete initiative');
      } finally {
        setIsDeleting(false);
        setDeleteDialogOpen(false);
      }
    }
  };
  const handleAddProduct = async (data: {
    name: string;
    price: string;
    description: string;
  }) => {
    setIsSubmitting(true);
    try {
      if (!boothId) {
        uniqueToast.error('Booth ID is missing');
        return;
      }
      const priceValue = parseFloat(data.price);
      if (isNaN(priceValue) || priceValue <= 0) {
        uniqueToast.error('Please enter a valid price');
        return;
      }
      const newProduct = {
        name: data.name,
        price: priceValue,
        description: data.description || ''
      };
      const success = await addProductToBooth(boothId, newProduct);
      if (success) {
        uniqueToast.success('Product added successfully');
        productForm.reset();
        const updatedBooth = getBoothById(boothId);
        setBooth(updatedBooth);
        if (updatedBooth && updatedBooth.products) {
          setProducts(updatedBooth.products);
        }
        setAddProductDialogOpen(false);
      } else {
        uniqueToast.error('Failed to add product');
      }
    } catch (error) {
      console.error('Error adding product:', error);
      uniqueToast.error('An error occurred while adding the product');
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleDeleteProduct = async (productId: string) => {
    try {
      if (!boothId) {
        uniqueToast.error('Booth ID is missing');
        return;
      }
      const success = await removeProductFromBooth(boothId, productId);
      if (success) {
        uniqueToast.success('Product removed successfully');
        const updatedBooth = getBoothById(boothId);
        setBooth(updatedBooth);
        if (updatedBooth && updatedBooth.products) {
          setProducts(updatedBooth.products);
        }
      } else {
        uniqueToast.error('Failed to remove product');
      }
    } catch (error) {
      console.error('Error removing product:', error);
      uniqueToast.error('An error occurred while removing the product');
    }
  };
  const handleUpdateProductPrice = async (productId: string, newPrice: number) => {
    try {
      if (!boothId) {
        uniqueToast.error('Booth ID is missing');
        return;
      }
      if (isNaN(newPrice) || newPrice <= 0) {
        uniqueToast.error('Please enter a valid price');
        return;
      }
      const productToUpdate = products.find(p => p.id === productId);
      if (!productToUpdate) {
        uniqueToast.error('Product not found');
        return;
      }
      const updatedProducts = products.map(p => {
        if (p.id === productId) {
          return {
            ...p,
            price: newPrice
          };
        }
        return p;
      });
      const removeSuccess = await removeProductFromBooth(boothId, productId);
      if (!removeSuccess) {
        uniqueToast.error('Failed to update product');
        return;
      }
      const updatedProduct = {
        ...productToUpdate,
        price: newPrice
      };
      const addSuccess = await addProductToBooth(boothId, updatedProduct);
      if (addSuccess) {
        uniqueToast.success('Product price updated successfully');
        const updatedBooth = getBoothById(boothId);
        setBooth(updatedBooth);
        if (updatedBooth && updatedBooth.products) {
          setProducts(updatedBooth.products);
        }
      } else {
        uniqueToast.error('Failed to update product price');
      }
    } catch (error) {
      console.error('Error updating product price:', error);
      uniqueToast.error('An error occurred while updating the product price');
    }
  };
  if (!booth) {
    return <Layout title="Initiative not found" showBack>
        <div className="text-center py-10">
          <p className="text-muted-foreground">The initiative you're looking for could not be found</p>
        </div>
      </Layout>;
  }
  return <Layout title={booth.name} subtitle="Initiative Management" showBack>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="dashboard" className="tab-button">Dashboard</TabsTrigger>
          <TabsTrigger value="sell" className="tab-button">Sell</TabsTrigger>
          <TabsTrigger value="transactions" className="tab-button">History</TabsTrigger>
          <TabsTrigger value="settings" className="tab-button">Settings</TabsTrigger>
        </TabsList>
        
        <TabsContent value="settings" className="animate-fade-in mt-6">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Initiative Information</CardTitle>
                <CardDescription>View your initiative details. Contact a SAC member if changes are needed.</CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Initiative Name</Label>
                  <Input id="name" value={booth.name} readOnly />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" value={booth.description || 'N/A'} readOnly />
                </div>
                
                <Separator />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Products</CardTitle>
                  <CardDescription>View products for this initiative. Contact a SAC member if changes are needed.</CardDescription>
                </div>
                <Dialog open={addProductDialogOpen} onOpenChange={setAddProductDialogOpen}>
                  {/* <DialogTrigger asChild>
                    <Button size="sm" className="ml-auto">
                      <Plus className="mr-2 h-4 w-4" /> Add Product
                    </Button>
                  </DialogTrigger> */}
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New Product</DialogTitle>
                      <DialogDescription>
                        Enter the details for the new product.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <Form {...productForm}>
                      <form onSubmit={productForm.handleSubmit(handleAddProduct)} className="space-y-4">
                        <FormField control={productForm.control} name="name" render={({
                        field
                      }) => <FormItem>
                              <FormLabel>Product Name</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="Enter product name" required />
                              </FormControl>
                              <FormMessage />
                            </FormItem>} />
                        
                        <FormField control={productForm.control} name="price" render={({
                        field
                      }) => <FormItem>
                              <FormLabel>Price ($)</FormLabel>
                              <FormControl>
                                <Input {...field} type="number" step="0.01" min="0.01" placeholder="0.00" required />
                              </FormControl>
                              <FormMessage />
                            </FormItem>} />
                        
                        <FormField control={productForm.control} name="description" render={({
                        field
                      }) => <FormItem>
                              
                              <FormControl>
                                
                              </FormControl>
                              <FormMessage />
                            </FormItem>} />
                        
                        <DialogFooter>
                          <Button type="button" variant="outline" onClick={() => setAddProductDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Adding...' : 'Add Product'}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              
              <CardContent>
                {products && products.length > 0 ? <div className="space-y-4">
                    {products.map(product => <div key={product.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                        <ProductItem product={product} editable={true} onPriceChange={newPrice => handleUpdateProductPrice(product.id, newPrice)} />
                        {/* <Button variant="ghost" size="icon" onClick={() => handleDeleteProduct(product.id)} title="Remove product" className="ml-2">
                          <Trash className="h-4 w-4 text-red-500" />
                        </Button> */}
                      </div>)}
                  </div> : <div className="text-center py-6 text-muted-foreground">
                    <Package className="mx-auto h-8 w-8 mb-2 opacity-50" />
                    <p>No products added yet</p>
                    <p className="text-sm">Add products to start selling</p>
                  </div>}
              </CardContent>
            </Card>
            
            <Separator />
            
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                
              </AlertDialogTrigger>
              
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete your initiative and all related data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteBooth} disabled={isDeleting}>
                    {isDeleting ? <>
                        Deleting...
                      </> : <>
                        Delete
                      </>}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </TabsContent>
      </Tabs>
    </Layout>;
};
export default BoothSettings;