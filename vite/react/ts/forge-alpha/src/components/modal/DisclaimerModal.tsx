import React, { useState, useEffect } from 'react';
import Button from '../ui/Button';

// Global keys for the tracking of "Do not show again" settings
export const disclaimerKeys = {
  trackAsset: 'track_asset'
}

interface DisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  storageKey?: string;
  title?: string;
  message?: string;
}

const DisclaimerModal = ({
  isOpen,
  onClose,
  onConfirm,
  storageKey,
  title = 'Please Confirm',
  message = 'Are you sure you want to proceed?'
}: DisclaimerModalProps) => {
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const [shouldRender, setShouldRender] = useState(true);

  useEffect(() => {
    if (storageKey && localStorage.getItem(`hideDisclaimer_${storageKey}`) === 'true') {
      setShouldRender(false);
    } else {
      setShouldRender(true);
    }
  }, [storageKey, isOpen]);

  const handleConfirm = () => {
    if (storageKey && doNotShowAgain) {
      localStorage.setItem(`hideDisclaimer_${storageKey}`, 'true');
    }
    onConfirm();
  };

  if (!isOpen || !shouldRender) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-black/80 border border-white/15 rounded-xl w-full max-w-md p-6 z-10">
        <h2 className="text-xl font-semibold text-white mb-3">{title}</h2>
        <p className="text-white/80 mb-4">{message}</p>

        {storageKey && (
          <label className="flex items-center mb-4 space-x-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={doNotShowAgain}
              onChange={(e) => setDoNotShowAgain(e.target.checked)}
              className="form-checkbox text-forge-orange"
            />
            <span>Don’t show this again</span>
          </label>
        )}

        <div className="flex justify-end space-x-3">
          <Button onClick={onClose} className="text-white hover:underline">Cancel</Button>
          <Button
            onClick={handleConfirm}
            className="bg-forge-orange hover:bg-forge-orange/90 text-white px-4 py-1 rounded-lg"
          >
            OK
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DisclaimerModal;
