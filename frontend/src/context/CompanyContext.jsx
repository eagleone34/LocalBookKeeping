import React, { createContext, useContext, useState, useEffect } from 'react';
import { getCompanies, createCompanyRecord } from '../api/client';

const CompanyContext = createContext();

export function CompanyProvider({ children }) {
  const [companies, setCompanies] = useState([]);
  const [currentCompany, setCurrentCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      const data = await getCompanies();
      setCompanies(data);
      
      const storedId = localStorage.getItem('company_id');
      if (storedId) {
        const found = data.find(c => c.id === parseInt(storedId, 10));
        if (found) {
          setCurrentCompany(found);
        } else if (data.length > 0) {
          setCurrentCompany(data[0]);
          localStorage.setItem('company_id', data[0].id);
        }
      } else if (data.length > 0) {
        setCurrentCompany(data[0]);
        localStorage.setItem('company_id', data[0].id);
      }
    } catch (err) {
      console.error("Failed to fetch companies:", err);
    } finally {
      setLoading(false);
    }
  };

  const switchCompany = (company) => {
    setCurrentCompany(company);
    localStorage.setItem('company_id', company.id);
    // Force a full reload to clear all React state (queries, caches, etc)
    window.location.reload();
  };

  const createCompany = async (name) => {
    try {
      const newCompany = await createCompanyRecord({ name, currency: 'USD' });
      setCompanies([...companies, newCompany]);
      switchCompany(newCompany);
      return newCompany;
    } catch (err) {
      console.error("Failed to create company:", err);
      throw err;
    }
  };

  return (
    <CompanyContext.Provider value={{
      companies,
      currentCompany,
      loading,
      switchCompany,
      createCompany
    }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}
